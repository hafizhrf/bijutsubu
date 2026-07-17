import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardCircleIcon } from "@hugeicons/core-free-icons";
import { deriveWidgetRects } from "@/components/genui/DashboardGrid";
import { colorForIndex } from "@/lib/chartColors";
import { cn } from "@/lib/utils";
import type { SavedDashboardWidgetSummary, Widget } from "@/types/dashboard";

const CHART_TYPES = new Set(["line-chart", "area-chart", "bar-chart", "pie-chart", "donut-chart", "scatter-chart"]);

/**
 * Miniature preview of a saved dashboard's real layout — the same idea as the
 * compacted feature mocks on the login page. Widget rects come from the list
 * endpoint's compact layout signature and are resolved with the exact
 * flow-packing used by DashboardGrid, so the thumbnail mirrors the actual grid.
 */
export function DashboardThumbnail({ widgets, className }: { widgets?: SavedDashboardWidgetSummary[]; className?: string }) {
  const cells = useMemo(() => {
    if (!widgets || widgets.length === 0) return [];
    // deriveWidgetRects only reads id/type/grid, so the compact summary
    // entries can stand in for full widgets.
    const pseudo = widgets.map((widget, index) => ({ id: String(index), type: widget.type, grid: widget.grid })) as unknown as Widget[];
    const rects = deriveWidgetRects(pseudo);
    let statIndex = 0;
    return widgets.map((widget, index) => {
      const rect = rects.get(String(index))!;
      const style: React.CSSProperties = {};
      let colorClass = "bg-ink/15";
      if (widget.type === "stat-card") {
        style.backgroundColor = colorForIndex(statIndex);
        style.opacity = 0.75;
        statIndex += 1;
        colorClass = "";
      } else if (CHART_TYPES.has(widget.type)) {
        colorClass = "bg-accent-blue/40";
      } else if (widget.type === "text") {
        colorClass = "bg-ink/10";
      }
      return { rect, colorClass, style };
    });
  }, [widgets]);

  if (cells.length === 0) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface-muted text-ink-muted", className)}>
        <HugeiconsIcon icon={DashboardCircleIcon} className="h-4 w-4" />
      </div>
    );
  }

  const totalRows = Math.max(...cells.map(({ rect }) => rect.y + rect.h), 1);

  return (
    <div aria-hidden="true" className={cn("relative shrink-0 overflow-hidden rounded-lg border border-border-soft bg-surface-muted", className)}>
      {cells.map(({ rect, colorClass, style }, index) => (
        <span
          key={index}
          className={cn("absolute rounded-[2px]", colorClass)}
          style={{
            ...style,
            left: `calc(${(rect.x / 12) * 100}% + 1.5px)`,
            top: `calc(${(rect.y / totalRows) * 100}% + 1.5px)`,
            width: `calc(${(rect.w / 12) * 100}% - 3px)`,
            height: `calc(${(rect.h / totalRows) * 100}% - 3px)`,
          }}
        />
      ))}
    </div>
  );
}
