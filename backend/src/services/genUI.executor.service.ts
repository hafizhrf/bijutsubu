import { Connection } from "mongoose";
import { DateGranularity, QueryDSL, UiSpec, Widget } from "../schemas/uiSpec.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import {
  assertWhitelisted,
  buildComparePipeline,
  buildPipeline,
} from "./genUI.pipelineBuilder.service.js";

export interface WidgetData {
  widgetId: string;
  rows: Record<string, unknown>[];
}

type StatCardWidget = Extract<Widget, { type: "stat-card" }>;

/** Bucket size for the sparkline trend behind a compare period. */
const SPARKLINE_GRANULARITY: Record<DateGranularity, DateGranularity> = {
  day: "day",
  week: "day",
  month: "day",
  quarter: "week",
  year: "month",
};

/**
 * Derived trend query for a compared stat-card: same collection, joins, and
 * filters; the value metric bucketed over the compare date field. Latest 24
 * buckets, oldest-first for drawing.
 */
function buildSparklineQuery(widget: StatCardWidget): QueryDSL | null {
  const compare = widget.compare!;
  const metric = widget.query.metrics.find((m) => m.alias === widget.valueField);
  if (!metric) return null;
  return {
    ...widget.query,
    groupBy: [{ field: compare.dateField, granularity: SPARKLINE_GRANULARITY[compare.period] }],
    metrics: [metric],
    topN: null,
    sort: { field: compare.dateField, dir: "desc" },
    limit: 24,
  };
}

async function runQuery(
  conn: Connection,
  collection: string,
  pipeline: ReturnType<typeof buildPipeline>,
): Promise<Record<string, unknown>[]> {
  assertWhitelisted(pipeline);
  const rows = await conn
    .collection(collection)
    .aggregate(pipeline, { allowDiskUse: false })
    .toArray();
  return rows as Record<string, unknown>[];
}

export async function executeUiSpec(conn: Connection, uiSpec: UiSpec): Promise<WidgetData[]> {
  const MetaCollection = getMetaCollectionModel(conn);
  const knownCollections = new Set((await MetaCollection.find().select("name").lean()).map((c) => c.name));

  const results: WidgetData[] = [];

  for (const widget of uiSpec.widgets) {
    if (widget.type === "text" || widget.type === "html") continue; // static content, no data to fetch
    const { query } = widget;

    if (!knownCollections.has(query.collection)) {
      results.push({ widgetId: widget.id, rows: [] });
      continue;
    }
    for (const join of query.joins) {
      if (!knownCollections.has(join.collection)) {
        throw new Error(`Widget "${widget.id}" joins an unknown collection: ${join.collection}`);
      }
    }

    const isComparedStatCard = widget.type === "stat-card" && widget.compare !== null;
    const pipeline = isComparedStatCard
      ? buildComparePipeline(query, widget.compare!, widget.valueField)
      : buildPipeline(query);

    results.push({ widgetId: widget.id, rows: await runQuery(conn, query.collection, pipeline) });

    // Extra bucketed trend for the card; the "::sparkline" suffix keeps it
    // invisible to renderers that only look up plain widget ids.
    if (isComparedStatCard && widget.sparkline) {
      const sparkQuery = buildSparklineQuery(widget);
      if (sparkQuery) {
        const rows = await runQuery(conn, query.collection, buildPipeline(sparkQuery));
        results.push({ widgetId: `${widget.id}::sparkline`, rows: rows.reverse() });
      }
    }
  }

  return results;
}
