import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { cn } from "@/lib/utils";
import type { ListWidget as ListWidgetSpec, WidgetRow } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  File02Icon,
  InboxIcon,
} from "@hugeicons/core-free-icons";

interface ListWidgetProps {
  widget: ListWidgetSpec;
  rows: WidgetRow[];
}

/** Cycling icon-tile backgrounds: pink, purple, blue, amber. */
const TILE_CLASSES = ["bg-pink-500", "bg-violet-500", "bg-blue-500", "bg-amber-500"] as const;

function formatCell(value: unknown): string {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function ListWidget({ widget, rows }: ListWidgetProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-1.5 text-ink-muted">
        <HugeiconsIcon icon={InboxIcon} className="h-5 w-5" />
        <p className="text-sm">No data to display</p>
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-y-auto", THIN_SCROLLBAR_CLASS)}>
      <ul className="divide-y divide-border-soft">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white",
                TILE_CLASSES[index % TILE_CLASSES.length],
              )}
            >
              <HugeiconsIcon icon={File02Icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{formatCell(row[widget.titleField])}</p>
              {widget.subtitleField !== null && (
                <p className="mt-0.5 truncate text-xs text-ink-muted">{formatCell(row[widget.subtitleField])}</p>
              )}
            </div>
            {widget.valueField !== null && (
              <span className="shrink-0 text-right text-sm font-bold tabular-nums text-ink">
                {formatCell(row[widget.valueField])}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
