import type { CSSProperties } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableWidget } from "@/components/genui/DataTableWidget";
import { BarChartWidget } from "@/components/genui/BarChartWidget";
import { LineChartWidget } from "@/components/genui/LineChartWidget";
import { AreaChartWidget } from "@/components/genui/AreaChartWidget";
import { ScatterChartWidget } from "@/components/genui/ScatterChartWidget";
import { PieChartWidget } from "@/components/genui/PieChartWidget";
import { DonutChartWidget } from "@/components/genui/DonutChartWidget";
import { ListWidget } from "@/components/genui/ListWidget";
import { ProgressWidget } from "@/components/genui/ProgressWidget";
import { useChartExport } from "@/components/genui/internal/useChartExport";
import { cn } from "@/lib/utils";
import type { StatCardWidget, TextWidget, HtmlWidget, Widget, WidgetRow } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";

/** Chart widgets fill their parent, so they need an explicit height. */
export const CHART_TYPES = new Set<Widget["type"]>([
  "bar-chart",
  "line-chart",
  "area-chart",
  "scatter-chart",
  "pie-chart",
  "donut-chart",
]);

export type BodyWidget = Exclude<Widget, StatCardWidget | TextWidget | HtmlWidget>;

export function renderWidgetBody(widget: BodyWidget, rows: WidgetRow[]) {
  switch (widget.type) {
    case "data-table":
      return <DataTableWidget widget={widget} rows={rows} />;
    case "bar-chart":
      return <BarChartWidget widget={widget} rows={rows} />;
    case "line-chart":
      return <LineChartWidget widget={widget} rows={rows} />;
    case "area-chart":
      return <AreaChartWidget widget={widget} rows={rows} />;
    case "scatter-chart":
      return <ScatterChartWidget widget={widget} rows={rows} />;
    case "pie-chart":
      return <PieChartWidget widget={widget} rows={rows} />;
    case "donut-chart":
      return <DonutChartWidget widget={widget} rows={rows} />;
    case "list":
      return <ListWidget widget={widget} rows={rows} />;
    case "progress":
      return <ProgressWidget widget={widget} rows={rows} />;
  }
}

function ChartDownloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted opacity-0 transition-all hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover/widget:opacity-100"
      aria-label="Download chart as PNG"
      title="Download PNG"
    >
      <HugeiconsIcon icon={Download01Icon} className="h-4 w-4" />
    </button>
  );
}

interface WidgetCardProps {
  widget: BodyWidget;
  rows: WidgetRow[];
  /** "card" = standalone dashboard card; "plain" = embedded page section. */
  variant?: "card" | "plain";
  /** When true the body stretches to the container height (grid mode) instead of the fixed h-80. */
  fillHeight?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shared per-widget chrome (title header, chart PNG download, chart height
 * handling) used by both the static WidgetStack/PageStack renderers and the
 * editable dashboard grid.
 */
export function WidgetCard({
  widget,
  rows,
  variant = "card",
  fillHeight = false,
  className,
  style,
}: WidgetCardProps) {
  const isChart = CHART_TYPES.has(widget.type);
  const { containerRef, exportPng } = useChartExport(widget.title);

  const body = (
    <div ref={containerRef} className={cn("min-h-0", isChart && (fillHeight ? "h-full" : "h-80"), fillHeight && "flex-1")}>
      {renderWidgetBody(widget, rows)}
    </div>
  );

  if (variant === "plain") {
    return (
      <div className={cn("group/widget px-6 py-6", className)} style={style}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="truncate text-base font-semibold text-ink">{widget.title}</h3>
          {isChart && <ChartDownloadButton onClick={exportPng} />}
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card className={cn("group/widget", fillHeight && "flex h-full flex-col", className)} style={style}>
      <CardHeader className={cn("flex-row items-center justify-between gap-3 space-y-0 p-6 pb-4", fillHeight && "shrink-0")}>
        <CardTitle className="truncate">{widget.title}</CardTitle>
        {isChart && <ChartDownloadButton onClick={exportPng} />}
      </CardHeader>
      <CardContent className={cn(fillHeight && "flex min-h-0 flex-1 flex-col")}>{body}</CardContent>
    </Card>
  );
}
