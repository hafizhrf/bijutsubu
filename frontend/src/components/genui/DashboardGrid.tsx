import { useMemo } from "react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { StatCard } from "@/components/genui/StatCard";
import { TextBlock } from "@/components/genui/TextBlock";
import { WidgetCard, CHART_TYPES } from "@/components/genui/WidgetCard";
import { cn } from "@/lib/utils";
import type { GridRect, UiSpec, Widget, WidgetData, WidgetRow } from "@/types/dashboard";

export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 56;

interface DashboardGridProps {
  uiSpec: UiSpec;
  data: WidgetData[];
  /** When true widgets can be dragged/resized; layout changes stream to onLayoutChange. */
  editing?: boolean;
  onLayoutChange?: (layout: Record<string, GridRect>) => void;
}

function defaultRectFor(widget: Widget): { w: number; h: number } {
  switch (widget.type) {
    case "stat-card":
      return { w: 3, h: 3 };
    case "data-table":
      return { w: 12, h: 7 };
    case "text":
      return { w: 12, h: 1 };
    case "html":
      return { w: 12, h: 6 };
    case "list":
    case "progress":
      return { w: 6, h: 6 };
    default:
      // charts
      return { w: 6, h: 6 };
  }
}

/**
 * Derive grid rects for widgets whose `grid` is null (LLM omissions and
 * dashboards saved before per-widget rects existed): simple left-to-right
 * flow packing that mirrors the static WidgetStack's visual order.
 */
export function deriveWidgetRects(widgets: Widget[]): Map<string, GridRect> {
  const rects = new Map<string, GridRect>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const widget of widgets) {
    if (widget.grid) {
      // Trusted as-is; flow packing only fills the gaps.
      rects.set(widget.id, widget.grid);
      continue;
    }
    const { w, h } = defaultRectFor(widget);
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    rects.set(widget.id, { x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return rects;
}

function layoutToRects(layout: Layout): Record<string, GridRect> {
  const rects: Record<string, GridRect> = {};
  for (const item of layout) {
    rects[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  return rects;
}

function minSizeFor(widget: Widget): { minW: number; minH: number } {
  switch (widget.type) {
    case "stat-card":
      return { minW: 2, minH: 2 };
    case "text":
      return { minW: 3, minH: 1 };
    case "data-table":
      return { minW: 4, minH: 4 };
    default:
      return { minW: 3, minH: 3 };
  }
}

/**
 * Grid-shaped dashboard renderer honoring each widget's 12-column `grid`
 * rect, with optional drag/resize editing (react-grid-layout v2). Specs that
 * contain html sections keep using the seamless PageStack instead — page
 * flows are not grid-editable.
 */
export function DashboardGrid({ uiSpec, data, editing = false, onLayoutChange }: DashboardGridProps) {
  const { width, mounted, containerRef } = useContainerWidth();

  const rowsByWidgetId = useMemo(
    () => new Map(data.map((entry) => [entry.widgetId, entry.rows])),
    [data],
  );

  const layout = useMemo<LayoutItem[]>(() => {
    const derived = deriveWidgetRects(uiSpec.widgets);
    return uiSpec.widgets.map((widget) => {
      const rect = derived.get(widget.id)!;
      return { i: widget.id, ...rect, ...minSizeFor(widget) };
    });
  }, [uiSpec.widgets]);

  let statCardCount = 0;

  return (
    <div ref={containerRef} className={cn(editing && "rounded-card ring-2 ring-primary/30 ring-offset-4 ring-offset-canvas")}>
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: [20, 20], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, cancel: "button, a, input, select, textarea" }}
          resizeConfig={{ enabled: editing, handles: ["se"] }}
          onLayoutChange={(next) => onLayoutChange?.(layoutToRects(next))}
        >
          {uiSpec.widgets.map((widget) => {
            const rows: WidgetRow[] = rowsByWidgetId.get(widget.id) ?? [];
            const editingClass = cn(
              "h-full",
              editing && "cursor-grab select-none active:cursor-grabbing",
            );

            if (widget.type === "stat-card") {
              const paletteIndex = statCardCount;
              statCardCount += 1;
              return (
                <div key={widget.id} className={editingClass}>
                  <StatCard
                    widget={widget}
                    rows={rows}
                    sparklineRows={rowsByWidgetId.get(`${widget.id}::sparkline`)}
                    paletteIndex={paletteIndex}
                  />
                </div>
              );
            }
            if (widget.type === "text") {
              return (
                <div key={widget.id} className={cn(editingClass, "flex flex-col justify-center")}>
                  <TextBlock widget={widget} />
                </div>
              );
            }
            if (widget.type === "html") {
              // Defensive: html specs normally render via PageStack.
              return <div key={widget.id} className={editingClass} />;
            }
            return (
              <div key={widget.id} className={editingClass}>
                <WidgetCard
                  widget={widget}
                  rows={rows}
                  fillHeight
                  className={cn(CHART_TYPES.has(widget.type) && "min-h-0")}
                />
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
