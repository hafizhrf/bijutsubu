import { PipelineStage } from "mongoose";
import {
  DateGranularity,
  QueryDSL,
  groupByFieldName,
} from "../schemas/uiSpec.schema.js";

export const ALLOWED_STAGES = new Set([
  "$match",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$project",
  "$unwind",
  "$lookup",
  "$addFields",
  "$count",
  "$facet",
]);

const OP_MAP: Record<string, string> = {
  eq: "$eq",
  ne: "$ne",
  gt: "$gt",
  gte: "$gte",
  lt: "$lt",
  lte: "$lte",
  in: "$in",
  nin: "$nin",
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tolerant date coercion: legacy rows routinely store dates as ISO strings. */
function toDateExpr(fieldRef: string) {
  return { $convert: { input: fieldRef, to: "date", onError: null, onNull: null } };
}

function buildJoinStages(dsl: QueryDSL): PipelineStage[] {
  const stages: PipelineStage[] = [];
  for (const join of dsl.joins) {
    // Pipeline-form lookup comparing canonical string forms instead of a
    // plain localField/foreignField equality: foreign keys are routinely
    // stored as hex STRINGS (JSON round-trips, relation pickers) while _id is
    // an ObjectId, and a naive $lookup silently matches nothing across that
    // type gap. Array-valued local fields (many-to-many) match any element.
    const toStr = (input: string) => ({
      $convert: { input, to: "string", onError: null, onNull: null },
    });
    stages.push({
      $lookup: {
        from: join.collection,
        as: join.as,
        let: { localValue: `$${join.localField}` },
        pipeline: [
          {
            $match: {
              $expr: {
                $in: [
                  toStr(`$${join.foreignField}`),
                  {
                    $map: {
                      input: {
                        $cond: [{ $isArray: "$$localValue" }, "$$localValue", ["$$localValue"]],
                      },
                      as: "v",
                      in: toStr("$$v"),
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
  }
  return stages;
}

function buildMatchStage(dsl: QueryDSL): PipelineStage | null {
  if (dsl.filters.length === 0) return null;
  const matchExpr: Record<string, unknown> = {};
  for (const f of dsl.filters) {
    if (f.op === "contains") {
      matchExpr[f.field] = { $regex: escapeRegex(String(f.value)), $options: "i" };
    } else if (f.op === "eq" && typeof f.value === "string") {
      // LLM prompts carry user-typed casing ("kitchen" vs "Kitchen"); exact
      // string equality is matched case-insensitively so those still hit.
      matchExpr[f.field] = { $regex: `^${escapeRegex(f.value)}$`, $options: "i" };
    } else if (f.op === "ne" && typeof f.value === "string") {
      matchExpr[f.field] = { $not: { $regex: `^${escapeRegex(f.value)}$`, $options: "i" } };
    } else {
      matchExpr[f.field] = { [OP_MAP[f.op]]: f.value };
    }
  }
  return { $match: matchExpr };
}

function buildAccumulators(dsl: QueryDSL): Record<string, unknown> {
  const accumulators: Record<string, unknown> = {};
  for (const m of dsl.metrics) {
    accumulators[m.alias] = m.func === "count" ? { $sum: 1 } : { [`$${m.func}`]: `$${m.field}` };
  }
  return accumulators;
}

/**
 * Keep the n largest groups (ordered by a metric) and optionally collapse the
 * rest into one synthetic "Other" row. Runs after $group/$project, so rows
 * already have the shape { <groupField>, <alias>... }. Zod guarantees exactly
 * one groupBy key, ≥1 metric, and (for includeOther) sum/count-only metrics —
 * the only funcs that stay honest when re-aggregated with $sum.
 */
function buildTopNStages(dsl: QueryDSL): PipelineStage[] {
  const topN = dsl.topN!;
  const groupField = groupByFieldName(dsl.groupBy[0]);
  const aliases = dsl.metrics.map((m) => m.alias);
  // Rank by the DSL's own sort metric when it points at one, else the first.
  const rankAlias =
    dsl.sort && aliases.includes(dsl.sort.field) ? dsl.sort.field : aliases[0];

  const stages: PipelineStage[] = [{ $sort: { [rankAlias]: -1 } }];

  if (!topN.includeOther) {
    stages.push({ $limit: topN.n });
    return stages;
  }

  const otherAccumulators = Object.fromEntries(
    aliases.map((alias) => [alias, { $sum: `$${alias}` }]),
  );
  const otherProject: Record<string, unknown> = {
    _id: 0,
    [groupField]: { $literal: "Other" },
  };
  for (const alias of aliases) otherProject[alias] = 1;

  const rowProject: Record<string, unknown> = {
    _id: 0,
    [groupField]: `$rows.${groupField}`,
  };
  for (const alias of aliases) rowProject[alias] = `$rows.${alias}`;

  stages.push(
    {
      $facet: {
        top: [{ $limit: topN.n }],
        rest: [
          { $skip: topN.n },
          { $group: { _id: null, ...otherAccumulators } },
          { $project: otherProject },
        ],
      },
    },
    { $project: { rows: { $concatArrays: ["$top", "$rest"] } } },
    { $unwind: "$rows" },
    { $project: rowProject },
  );
  return stages;
}

/**
 * The only code path that constructs Mongo aggregation pipeline stages. The
 * LLM never emits pipeline syntax directly — only the constrained QueryDSL
 * (filters/joins/groupBy/metrics/topN/sort/limit), which this function
 * translates deterministically into a whitelisted-stages-only pipeline.
 */
export function buildPipeline(dsl: QueryDSL): PipelineStage[] {
  const stages: PipelineStage[] = buildJoinStages(dsl);

  const match = buildMatchStage(dsl);
  if (match) stages.push(match);

  if (dsl.metrics.length > 0) {
    const groupId = dsl.groupBy.length
      ? Object.fromEntries(
          dsl.groupBy.map((entry) => {
            const field = groupByFieldName(entry);
            // Bucketed entries group on the truncated date; $dateTrunc needs
            // MongoDB >= 5.0. Plain entries group on the raw value.
            const keyExpr =
              typeof entry === "string"
                ? `$${entry}`
                : { $dateTrunc: { date: toDateExpr(`$${entry.field}`), unit: entry.granularity } };
            return [field, keyExpr];
          }),
        )
      : null;
    stages.push({ $group: { _id: groupId, ...buildAccumulators(dsl) } });

    if (dsl.groupBy.length) {
      // Re-map group keys back to their original field names so widget
      // xField/column references keep working, bucketed or not.
      const projectFields: Record<string, unknown> = { _id: 0 };
      for (const entry of dsl.groupBy) {
        const field = groupByFieldName(entry);
        projectFields[field] = `$_id.${field}`;
      }
      for (const m of dsl.metrics) projectFields[m.alias] = 1;
      stages.push({ $project: projectFields });
    }
  }

  if (dsl.topN && dsl.metrics.length > 0 && dsl.groupBy.length === 1) {
    stages.push(...buildTopNStages(dsl));
  }

  if (dsl.sort) {
    stages.push({ $sort: { [dsl.sort.field]: dsl.sort.dir === "asc" ? 1 : -1 } });
  }

  stages.push({ $limit: dsl.limit });

  return stages;
}

/** UTC start of the period containing `at`. Weeks start on Monday. */
function periodStart(at: Date, period: DateGranularity): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  switch (period) {
    case "day":
      return d;
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
      d.setUTCDate(d.getUTCDate() - dow);
      return d;
    }
    case "month":
      return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    case "quarter":
      return new Date(Date.UTC(at.getUTCFullYear(), Math.floor(at.getUTCMonth() / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(at.getUTCFullYear(), 0, 1));
  }
}

export interface ComparePeriods {
  currentStart: Date;
  /** Exclusive end of the current window (start of the next period). */
  currentEnd: Date;
  previousStart: Date;
}

export function resolveComparePeriods(period: DateGranularity, now = new Date()): ComparePeriods {
  const currentStart = periodStart(now, period);
  const previousStart = periodStart(new Date(currentStart.getTime() - 1), period);
  // Next period's start = exclusive end of the current window. Derive it by
  // mirroring the previous-period distance forward — exact for day/week, and
  // safe for month/quarter/year via an over-shoot then re-truncate.
  const approxNext = new Date(currentStart.getTime() + (currentStart.getTime() - previousStart.getTime()) + 86_400_000);
  const currentEnd = periodStart(approxNext, period);
  return { currentStart, currentEnd, previousStart };
}

/**
 * Stat-card previous-period comparison: one pipeline that computes every
 * metric for the current and previous period windows and a guarded percentage
 * delta ("deltaPct") for the card's value metric. Period boundaries are
 * computed here in JS — the LLM never does date math.
 */
export function buildComparePipeline(
  dsl: QueryDSL,
  compare: { dateField: string; period: DateGranularity },
  valueAlias: string,
): PipelineStage[] {
  const { currentStart, currentEnd, previousStart } = resolveComparePeriods(compare.period);
  const dateExpr = toDateExpr(`$${compare.dateField}`);

  const windowMatch = (from: Date, to: Date): PipelineStage.FacetPipelineStage => ({
    $match: {
      $expr: {
        $and: [{ $gte: [dateExpr, from] }, { $lt: [dateExpr, to] }],
      },
    },
  });

  const groupStage = { $group: { _id: null, ...buildAccumulators(dsl) } } as const;

  const stages: PipelineStage[] = buildJoinStages(dsl);
  const match = buildMatchStage(dsl);
  if (match) stages.push(match);

  const finalProject: Record<string, unknown> = { _id: 0 };
  for (const m of dsl.metrics) {
    finalProject[m.alias] = { $ifNull: [`$current.${m.alias}`, 0] };
  }
  finalProject.deltaPct = {
    $let: {
      vars: {
        cur: { $ifNull: [`$current.${valueAlias}`, 0] },
        prev: { $ifNull: [`$previous.${valueAlias}`, 0] },
      },
      in: {
        $cond: [
          { $eq: ["$$prev", 0] },
          null,
          {
            $multiply: [
              { $divide: [{ $subtract: ["$$cur", "$$prev"] }, { $abs: "$$prev" }] },
              100,
            ],
          },
        ],
      },
    },
  };

  stages.push(
    {
      $facet: {
        current: [windowMatch(currentStart, currentEnd), groupStage],
        previous: [windowMatch(previousStart, currentStart), groupStage],
      },
    },
    {
      $project: {
        current: { $arrayElemAt: ["$current", 0] },
        previous: { $arrayElemAt: ["$previous", 0] },
      },
    },
    { $project: finalProject },
  );

  return stages;
}

export function assertWhitelisted(pipeline: PipelineStage[]): void {
  for (const stage of pipeline) {
    const stageKey = Object.keys(stage as unknown as Record<string, unknown>)[0];
    if (!stageKey || !ALLOWED_STAGES.has(stageKey)) {
      throw new Error(`Blocked non-whitelisted pipeline stage: ${stageKey}`);
    }
  }
}
