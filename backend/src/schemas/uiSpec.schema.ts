import { z } from "zod";

// ---- Query DSL (constrained; the LLM never emits raw Mongo pipeline syntax) ----

const FilterOpEnum = z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "contains"]);

const FilterConditionSchema = z.object({
  field: z.string().min(1),
  op: FilterOpEnum,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});

const JoinSchema = z.object({
  collection: z.string().min(1),
  localField: z.string().min(1),
  foreignField: z.string().min(1),
  as: z.string().min(1),
});

const AggFuncEnum = z.enum(["sum", "avg", "count", "min", "max"]);

const MetricSchema = z
  .object({
    field: z.string().nullable(),
    func: AggFuncEnum,
    alias: z.string().min(1),
  })
  .superRefine((val, ctx) => {
    if (val.func !== "count" && !val.field) {
      ctx.addIssue({
        code: "custom",
        message: "field is required unless func is 'count'",
        path: ["field"],
      });
    }
  });

const SortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(["asc", "desc"]),
});

export const DateGranularityEnum = z.enum(["day", "week", "month", "quarter", "year"]);
export type DateGranularity = z.infer<typeof DateGranularityEnum>;

// A groupBy entry is either a plain field name (group by raw value — the
// original form, kept so specs saved before bucketing existed still parse) or
// a date-bucketed form that truncates a date field to the given granularity.
const GroupByEntrySchema = z.union([
  z.string().min(1),
  z.object({ field: z.string().min(1), granularity: DateGranularityEnum }),
]);

export type GroupByEntry = z.infer<typeof GroupByEntrySchema>;

/** The result-row column name a groupBy entry produces (bucketed or not). */
export function groupByFieldName(entry: GroupByEntry): string {
  return typeof entry === "string" ? entry : entry.field;
}

export const QueryDSLSchema = z
  .object({
    collection: z.string().min(1),
    joins: z.array(JoinSchema).max(3).default([]),
    filters: z.array(FilterConditionSchema).max(10).default([]),
    // Empty groupBy + empty metrics means "return raw matched/joined rows" —
    // the shape a data-table widget wants. Any non-empty groupBy requires at
    // least one metric, since grouping with no accumulator is meaningless.
    groupBy: z.array(GroupByEntrySchema).max(5).default([]),
    metrics: z.array(MetricSchema).max(6).default([]),
    // Keep only the n largest groups; when includeOther is true the remaining
    // groups collapse into a single synthetic "Other" row.
    topN: z
      .object({
        n: z.number().int().min(1).max(50),
        includeOther: z.boolean().default(true),
      })
      .nullable()
      .default(null),
    sort: SortSchema.nullable().default(null),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .superRefine((val, ctx) => {
    if (val.groupBy.length > 0 && val.metrics.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "metrics must be non-empty when groupBy is set",
        path: ["metrics"],
      });
    }
    if (val.topN) {
      if (val.groupBy.length !== 1 || val.metrics.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "topN requires exactly one groupBy field and at least one metric",
          path: ["topN"],
        });
      } else if (
        val.topN.includeOther &&
        val.metrics.some((m) => m.func !== "sum" && m.func !== "count")
      ) {
        // avg/min/max can't be re-aggregated from per-group results, so an
        // honest "Other" bucket is only possible for additive metrics.
        ctx.addIssue({
          code: "custom",
          message: "topN.includeOther only supports sum/count metrics — set includeOther to false for avg/min/max",
          path: ["topN", "includeOther"],
        });
      }
    }
  });

export type QueryDSL = z.infer<typeof QueryDSLSchema>;

// ---- Layout: 12-column grid rect per widget (react-grid-layout compatible) ----

export const GridRectSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(400),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(30),
});

export type GridRect = z.infer<typeof GridRectSchema>;

// ---- Widgets ----

const DataWidgetBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  query: QueryDSLSchema,
  grid: GridRectSchema.nullable().default(null),
});

export const WidgetSchema = z.discriminatedUnion("type", [
  DataWidgetBaseSchema.extend({
    type: z.literal("stat-card"),
    valueField: z.string().min(1),
    deltaField: z.string().nullable().default(null),
    // Server-computed previous-period comparison: the executor swaps the
    // query for a current-vs-previous facet pipeline and emits a "deltaPct"
    // column (set deltaField to "deltaPct" to display it). Requires an empty
    // groupBy — the card shows one number, not a series.
    compare: z
      .object({
        dateField: z.string().min(1),
        period: DateGranularityEnum,
      })
      .nullable()
      .default(null),
    // When true (and compare is set) the executor runs one extra bucketed
    // trend query, delivered as widgetId "<id>::sparkline".
    sparkline: z.boolean().default(false),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("data-table"),
    columns: z.array(z.object({ field: z.string().min(1), label: z.string().min(1) })).min(1).max(12),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("bar-chart"),
    xField: z.string().min(1),
    yField: z.string().min(1),
    seriesField: z.string().nullable().default(null),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("line-chart"),
    xField: z.string().min(1),
    yField: z.string().min(1),
    seriesField: z.string().nullable().default(null),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("area-chart"),
    xField: z.string().min(1),
    yField: z.string().min(1),
    seriesField: z.string().nullable().default(null),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("scatter-chart"),
    xField: z.string().min(1),
    yField: z.string().min(1),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("pie-chart"),
    labelField: z.string().min(1),
    valueField: z.string().min(1),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("donut-chart"),
    labelField: z.string().min(1),
    valueField: z.string().min(1),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("list"),
    titleField: z.string().min(1),
    subtitleField: z.string().nullable().default(null),
    valueField: z.string().nullable().default(null),
  }),
  DataWidgetBaseSchema.extend({
    type: z.literal("progress"),
    labelField: z.string().nullable().default(null),
    valueField: z.string().min(1),
    // Fixed denominator for the bars; null means scale bars relative to the max row value.
    maxValue: z.number().positive().nullable().default(null),
  }),
  // Static content widget: no query, renders declarative text only (never HTML/code).
  z.object({
    id: z.string().min(1),
    type: z.literal("text"),
    variant: z.enum(["heading", "subheading", "body", "quote"]),
    content: z.string().min(1).max(2000),
    grid: GridRectSchema.nullable().default(null),
  }),
  // Free-form page section: HTML + inline CSS, no query. Sanitized server-side
  // (genUI.htmlSanitizer.service.ts) and again client-side before rendering
  // inside a shadow root — scripts/iframes/event handlers never survive.
  z.object({
    id: z.string().min(1),
    type: z.literal("html"),
    content: z.string().min(1).max(30000),
    grid: GridRectSchema.nullable().default(null),
  }),
]);

export type Widget = z.infer<typeof WidgetSchema>;

export const UiSpecSchema = z.object({
  title: z.string().min(1),
  // Legacy hint kept for backward compatibility with dashboards saved before
  // per-widget grid rects existed; the frontend derives default rects from it.
  layout: z.enum(["grid-2col", "grid-3col", "grid-4col"]).default("grid-3col"),
  widgets: z.array(WidgetSchema).min(1).max(16),
});

export type UiSpec = z.infer<typeof UiSpecSchema>;
