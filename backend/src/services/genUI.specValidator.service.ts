import { QueryDSL, UiSpec, Widget, groupByFieldName } from "../schemas/uiSpec.schema.js";

/**
 * Semantic grounding check for a generated UiSpec: every referenced
 * collection, join, query field, and widget display field must actually
 * exist. Zod can only enforce shape — this catches the model inventing
 * plausible-but-wrong names, which otherwise renders as silently-empty
 * columns/charts. Used by generateUiSpec for a one-shot repair round, then
 * as the filter that drops still-broken widgets.
 */

export interface CollectionShape {
  name: string;
  fields: { name: string; type: string }[];
}

export interface RelationShape {
  fromCollection: string;
  toCollection: string;
}

export interface SpecValidationResult {
  /** All problems, phrased for the LLM repair prompt. */
  errors: string[];
  /** Widget ids that had at least one problem (text/html never appear). */
  invalidWidgetIds: Set<string>;
}

interface FieldUniverse {
  exact: Set<string>;
  /** Prefixes (e.g. "customer." for a join alias) under which any sub-path is allowed. */
  dottedPrefixes: string[];
}

function buildBaseUniverse(
  collection: CollectionShape,
  query: QueryDSL,
): FieldUniverse {
  const exact = new Set<string>(["_id"]);
  const dottedPrefixes: string[] = [];
  for (const field of collection.fields) {
    exact.add(field.name);
    // Object/array values legitimately support sub-path access.
    if (field.type === "object" || field.type === "array") {
      dottedPrefixes.push(`${field.name}.`);
    }
  }
  for (const join of query.joins) {
    exact.add(join.as);
    dottedPrefixes.push(`${join.as}.`);
  }
  return { exact, dottedPrefixes };
}

function inUniverse(field: string, universe: FieldUniverse): boolean {
  if (universe.exact.has(field)) return true;
  return universe.dottedPrefixes.some((prefix) => field.startsWith(prefix));
}

function describeUniverse(universe: FieldUniverse): string {
  return [...universe.exact].join(", ");
}

/**
 * The columns a query's result rows actually have: with metrics it's exactly
 * groupBy + aliases (see buildPipeline's $group/$project); without metrics
 * it's the raw base universe.
 */
function outputChecker(
  query: QueryDSL,
  base: FieldUniverse,
): { has: (field: string) => boolean; describe: () => string } {
  if (query.metrics.length === 0) {
    return { has: (field) => inUniverse(field, base), describe: () => describeUniverse(base) };
  }
  const columns = new Set<string>([
    ...query.groupBy.map(groupByFieldName),
    ...query.metrics.map((m) => m.alias),
  ]);
  return { has: (field) => columns.has(field), describe: () => [...columns].join(", ") };
}

/**
 * Resolve a referenced field to its declared meta type when possible: plain
 * fields via the base collection, "alias.field" paths via the join's target
 * collection. Returns null when the type can't be determined (deep object
 * paths) — callers should treat that as "allowed".
 */
function resolveFieldType(
  field: string,
  collection: CollectionShape,
  query: QueryDSL,
  byName: Map<string, CollectionShape>,
): string | null {
  const direct = collection.fields.find((f) => f.name === field);
  if (direct) return direct.type;
  const dot = field.indexOf(".");
  if (dot > 0) {
    const head = field.slice(0, dot);
    const rest = field.slice(dot + 1);
    const join = query.joins.find((j) => j.as === head);
    if (join) {
      const target = byName.get(join.collection);
      const targetField = target?.fields.find((f) => f.name === rest);
      if (targetField) return targetField.type;
    }
  }
  return null;
}

function widgetDisplayFields(widget: Widget): { label: string; field: string }[] {
  switch (widget.type) {
    case "stat-card":
      return [
        { label: "valueField", field: widget.valueField },
        ...(widget.deltaField ? [{ label: "deltaField", field: widget.deltaField }] : []),
      ];
    case "data-table":
      return widget.columns.map((c) => ({ label: `columns.${c.field}`, field: c.field }));
    case "bar-chart":
    case "line-chart":
    case "area-chart":
      return [
        { label: "xField", field: widget.xField },
        { label: "yField", field: widget.yField },
        ...(widget.seriesField ? [{ label: "seriesField", field: widget.seriesField }] : []),
      ];
    case "scatter-chart":
      return [
        { label: "xField", field: widget.xField },
        { label: "yField", field: widget.yField },
      ];
    case "pie-chart":
    case "donut-chart":
      return [
        { label: "labelField", field: widget.labelField },
        { label: "valueField", field: widget.valueField },
      ];
    case "list":
      return [
        { label: "titleField", field: widget.titleField },
        ...(widget.subtitleField ? [{ label: "subtitleField", field: widget.subtitleField }] : []),
        ...(widget.valueField ? [{ label: "valueField", field: widget.valueField }] : []),
      ];
    case "progress":
      return [
        { label: "valueField", field: widget.valueField },
        ...(widget.labelField ? [{ label: "labelField", field: widget.labelField }] : []),
      ];
    case "text":
    case "html":
      return [];
  }
}

/**
 * Safety gate for client-round-tripped QueryDSL (saved custom tables):
 * buildPipeline uses DSL field names and aliases as Mongo object keys, so a
 * DSL that did not come straight from the LLM must never carry "$"-prefixed
 * names (operator injection) or dotted aliases (path traversal into the
 * accumulator objects). Field PATHS may contain dots (join sub-paths) but
 * never "$" anywhere in a segment head.
 */
export function findQueryDslSafetyViolations(query: QueryDSL): string[] {
  const violations: string[] = [];
  const badPath = (value: string) =>
    value.startsWith("$") || value.includes("\0") || value.split(".").some((seg) => seg.startsWith("$") || seg === "");
  const badName = (value: string) => badPath(value) || value.includes(".");

  if (badPath(query.collection)) violations.push(`unsafe collection name "${query.collection}"`);
  for (const join of query.joins) {
    if (badPath(join.collection)) violations.push(`unsafe join collection "${join.collection}"`);
    if (badPath(join.localField)) violations.push(`unsafe join localField "${join.localField}"`);
    if (badPath(join.foreignField)) violations.push(`unsafe join foreignField "${join.foreignField}"`);
    if (badName(join.as)) violations.push(`unsafe join alias "${join.as}"`);
  }
  for (const filter of query.filters) {
    if (badPath(filter.field)) violations.push(`unsafe filter field "${filter.field}"`);
  }
  for (const entry of query.groupBy) {
    const field = groupByFieldName(entry);
    if (badPath(field)) violations.push(`unsafe groupBy field "${field}"`);
  }
  for (const metric of query.metrics) {
    if (metric.field && badPath(metric.field)) violations.push(`unsafe metric field "${metric.field}"`);
    if (badName(metric.alias)) violations.push(`unsafe metric alias "${metric.alias}"`);
  }
  if (query.sort && badPath(query.sort.field)) violations.push(`unsafe sort field "${query.sort.field}"`);
  return violations;
}

/**
 * Grounding for a standalone QueryDSL (no widget): collection, joins, and
 * every referenced field must exist in the current meta. Reuses the same
 * universe logic as widget validation.
 */
export function validateStandaloneQuery(
  query: QueryDSL,
  collections: CollectionShape[],
  relations: RelationShape[],
): string[] {
  const byName = new Map(collections.map((c) => [c.name, c]));
  const relationPairs = new Set(
    relations.flatMap((r) => [
      `${r.fromCollection}|${r.toCollection}`,
      `${r.toCollection}|${r.fromCollection}`,
    ]),
  );
  const errors: string[] = [];

  const collection = byName.get(query.collection);
  if (!collection) {
    return [`collection "${query.collection}" does not exist`];
  }
  const base = buildBaseUniverse(collection, query);

  for (const join of query.joins) {
    const target = byName.get(join.collection);
    if (!target) {
      errors.push(`join target collection "${join.collection}" does not exist`);
      continue;
    }
    if (!relationPairs.has(`${query.collection}|${join.collection}`)) {
      errors.push(`join between "${query.collection}" and "${join.collection}" has no defined relation`);
    }
    if (!inUniverse(join.localField, base) && join.localField !== join.as) {
      errors.push(`join localField "${join.localField}" is not a field of "${query.collection}"`);
    }
    const targetFields = new Set(["_id", ...target.fields.map((f) => f.name)]);
    if (!targetFields.has(join.foreignField)) {
      errors.push(`join foreignField "${join.foreignField}" is not a field of "${join.collection}"`);
    }
  }
  for (const filter of query.filters) {
    if (!inUniverse(filter.field, base)) {
      errors.push(`filter field "${filter.field}" does not exist on "${query.collection}"`);
    }
  }
  for (const entry of query.groupBy) {
    const field = groupByFieldName(entry);
    if (!inUniverse(field, base)) {
      errors.push(`groupBy field "${field}" does not exist on "${query.collection}"`);
    }
  }
  for (const metric of query.metrics) {
    if (metric.func !== "count" && metric.field && !inUniverse(metric.field, base)) {
      errors.push(`metric field "${metric.field}" does not exist on "${query.collection}"`);
    }
  }
  const output = outputChecker(query, base);
  if (query.sort && !output.has(query.sort.field)) {
    errors.push(`sort field "${query.sort.field}" is not in the query result`);
  }
  return errors;
}

export function validateUiSpecReferences(
  uiSpec: UiSpec,
  collections: CollectionShape[],
  relations: RelationShape[],
): SpecValidationResult {
  const byName = new Map(collections.map((c) => [c.name, c]));
  const relationPairs = new Set(
    relations.flatMap((r) => [
      `${r.fromCollection}|${r.toCollection}`,
      `${r.toCollection}|${r.fromCollection}`,
    ]),
  );

  const errors: string[] = [];
  const invalidWidgetIds = new Set<string>();

  for (const widget of uiSpec.widgets) {
    if (widget.type === "text" || widget.type === "html") continue;

    const widgetErrors: string[] = [];
    const { query } = widget;
    const collection = byName.get(query.collection);

    if (!collection) {
      widgetErrors.push(
        `collection "${query.collection}" does not exist (existing: ${[...byName.keys()].join(", ") || "none"})`,
      );
    } else {
      const base = buildBaseUniverse(collection, query);

      for (const join of query.joins) {
        const target = byName.get(join.collection);
        if (!target) {
          widgetErrors.push(`join target collection "${join.collection}" does not exist`);
          continue;
        }
        if (!relationPairs.has(`${query.collection}|${join.collection}`)) {
          widgetErrors.push(
            `join between "${query.collection}" and "${join.collection}" has no defined relation — drop the join or use a related collection`,
          );
        }
        if (!inUniverse(join.localField, base) && join.localField !== join.as) {
          widgetErrors.push(
            `join localField "${join.localField}" is not a field of "${query.collection}"`,
          );
        }
        const targetFields = new Set(["_id", ...target.fields.map((f) => f.name)]);
        if (!targetFields.has(join.foreignField)) {
          widgetErrors.push(
            `join foreignField "${join.foreignField}" is not a field of "${join.collection}"`,
          );
        }
      }

      for (const filter of query.filters) {
        if (!inUniverse(filter.field, base)) {
          widgetErrors.push(`filter field "${filter.field}" does not exist on "${query.collection}"`);
        }
      }
      for (const entry of query.groupBy) {
        const groupField = groupByFieldName(entry);
        if (!inUniverse(groupField, base)) {
          widgetErrors.push(`groupBy field "${groupField}" does not exist on "${query.collection}"`);
        } else if (typeof entry !== "string") {
          const type = resolveFieldType(groupField, collection, query, byName);
          if (type !== null && type !== "date") {
            widgetErrors.push(
              `groupBy field "${groupField}" has type "${type}" — date bucketing (granularity) is only valid on date fields; group by the plain field name instead`,
            );
          }
        }
      }
      for (const metric of query.metrics) {
        if (metric.func !== "count" && metric.field && !inUniverse(metric.field, base)) {
          widgetErrors.push(`metric field "${metric.field}" does not exist on "${query.collection}"`);
        }
      }

      const output = outputChecker(query, base);
      if (query.sort && !output.has(query.sort.field)) {
        widgetErrors.push(
          `sort field "${query.sort.field}" is not in the query result (available: ${output.describe()})`,
        );
      }

      if (widget.type === "stat-card" && query.metrics.length === 0) {
        widgetErrors.push(`stat-card needs at least one metric; valueField must be a metric alias`);
      }

      // Previous-period comparison: the executor swaps in a facet pipeline
      // that emits every metric alias plus "deltaPct" — grounding must match.
      let hasOutput = (field: string) => output.has(field);
      if (widget.type === "stat-card" && widget.compare) {
        if (query.groupBy.length > 0) {
          widgetErrors.push(`stat-card "compare" requires an empty groupBy — the card shows a single number`);
        }
        const dateField = widget.compare.dateField;
        if (!inUniverse(dateField, base)) {
          widgetErrors.push(`compare.dateField "${dateField}" does not exist on "${query.collection}"`);
        } else {
          const type = resolveFieldType(dateField, collection, query, byName);
          if (type !== null && type !== "date") {
            widgetErrors.push(
              `compare.dateField "${dateField}" has type "${type}" — comparison periods need a date field`,
            );
          }
        }
        hasOutput = (field) => field === "deltaPct" || output.has(field);
      }

      for (const { label, field } of widgetDisplayFields(widget)) {
        if (!hasOutput(field)) {
          widgetErrors.push(
            `${label} "${field}" is not in the query result (available: ${output.describe()})`,
          );
        }
      }
    }

    if (widgetErrors.length > 0) {
      invalidWidgetIds.add(widget.id);
      errors.push(...widgetErrors.map((message) => `[widget "${widget.id}"] ${message}`));
    }
  }

  return { errors, invalidWidgetIds };
}
