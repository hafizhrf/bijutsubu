export type QueryDSL = unknown;

/** Position and size on the 12-column dashboard grid (x 0-11, w 1-12, h in row units). */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DataWidgetBase {
  id: string;
  title: string;
  query: QueryDSL;
  /** May be null for LLM omissions or dashboards saved before grid layouts existed. */
  grid: GridRect | null;
}

export type ComparePeriod = "day" | "week" | "month" | "quarter" | "year";

export type StatCardWidget = DataWidgetBase & {
  type: "stat-card";
  valueField: string;
  deltaField: string | null;
  /** Server-computed previous-period comparison; emits a "deltaPct" column. */
  compare: { dateField: string; period: ComparePeriod } | null;
  /** Extra trend rows delivered under widgetId "<id>::sparkline". */
  sparkline: boolean;
};

export type DataTableWidget = DataWidgetBase & {
  type: "data-table";
  columns: { field: string; label: string }[];
};

export type BarChartWidget = DataWidgetBase & {
  type: "bar-chart";
  xField: string;
  yField: string;
  seriesField: string | null;
};

export type LineChartWidget = DataWidgetBase & {
  type: "line-chart";
  xField: string;
  yField: string;
  seriesField: string | null;
};

export type AreaChartWidget = DataWidgetBase & {
  type: "area-chart";
  xField: string;
  yField: string;
  seriesField: string | null;
};

export type ScatterChartWidget = DataWidgetBase & {
  type: "scatter-chart";
  xField: string;
  yField: string;
};

export type PieChartWidget = DataWidgetBase & {
  type: "pie-chart";
  labelField: string;
  valueField: string;
};

export type DonutChartWidget = DataWidgetBase & {
  type: "donut-chart";
  labelField: string;
  valueField: string;
};

export type ListWidget = DataWidgetBase & {
  type: "list";
  titleField: string;
  subtitleField: string | null;
  valueField: string | null;
};

export type ProgressWidget = DataWidgetBase & {
  type: "progress";
  labelField: string | null;
  valueField: string;
  maxValue: number | null;
};

export type TextWidgetVariant = "heading" | "subheading" | "body" | "quote";

/** Static copy on the canvas — no query, no title, and no data entry in the response. */
export type TextWidget = {
  id: string;
  type: "text";
  variant: TextWidgetVariant;
  content: string;
  grid: GridRect | null;
};

/** Free-form page section (hero, pricing grid, CTA …). Sanitized server-side
 *  and again client-side, rendered inside a shadow root. */
export type HtmlWidget = {
  id: string;
  type: "html";
  content: string;
  grid: GridRect | null;
};

export type Widget =
  | StatCardWidget
  | DataTableWidget
  | BarChartWidget
  | LineChartWidget
  | AreaChartWidget
  | ScatterChartWidget
  | PieChartWidget
  | DonutChartWidget
  | ListWidget
  | ProgressWidget
  | TextWidget
  | HtmlWidget;

export type WidgetType = Widget["type"];

export type DashboardLayout = "grid-2col" | "grid-3col" | "grid-4col";

export interface UiSpec {
  title: string;
  /** Legacy fallback hint; the real layout lives in each widget's `grid` rect. */
  layout: DashboardLayout;
  widgets: Widget[];
}

export type WidgetRow = Record<string, unknown>;

export interface WidgetData {
  widgetId: string;
  rows: WidgetRow[];
}

export type RejectionCategory =
  | "off_topic"
  | "destructive_request"
  | "prompt_injection"
  | "inappropriate_content"
  | "ambiguous"
  | "visualization_request"
  | "page_design_request";

export interface RejectedResponse {
  rejected: true;
  reason: string;
  category: RejectionCategory;
}

export interface SavedDashboardSummary {
  _id: string;
  title: string;
  prompt: string;
  createdAt: string;
}

export interface DashboardChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SavedDashboardDetail extends SavedDashboardSummary {
  messages: DashboardChatMessage[];
  uiSpec: UiSpec;
  data: WidgetData[];
}

/** POST /dashboard/generate. requestId stays stable across client retries. */
export interface GenerateDashboardRequest {
  prompt: string;
  requestId: string;
}

/** POST /dashboard/saved/:id/refine */
export interface RefineDashboardResponse {
  uiSpec: UiSpec;
  data: WidgetData[];
  note: string;
  messages: DashboardChatMessage[];
}

/** POST /dashboard/generate — the result is auto-saved server-side. */
export interface GenerateDashboardResponse {
  dashboard: SavedDashboardSummary;
  uiSpec: UiSpec;
  data: WidgetData[];
}
