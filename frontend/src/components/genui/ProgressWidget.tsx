import { useMemo } from "react";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { cn } from "@/lib/utils";
import type { ProgressWidget as ProgressWidgetSpec, WidgetRow } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InboxIcon,
} from "@hugeicons/core-free-icons";

interface ProgressWidgetProps {
  widget: ProgressWidgetSpec;
  rows: WidgetRow[];
}

/** Gradient bar fills cycled per row, matching the chart palette. */
const BAR_GRADIENTS = [
  "bg-gradient-to-r from-[#8b5cf6] to-[#a78bfa]",
  "bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]",
  "bg-gradient-to-r from-[#ec4899] to-[#f9a8d4]",
  "bg-gradient-to-r from-[#06b6d4] to-[#67e8f9]",
  "bg-gradient-to-r from-[#6366f1] to-[#a5b4fc]",
  "bg-gradient-to-r from-[#10b981] to-[#6ee7b7]",
] as const;

function toNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function ProgressWidget({ widget, rows }: ProgressWidgetProps) {
  const values = useMemo(() => rows.map((row) => toNumber(row[widget.valueField])), [rows, widget.valueField]);
  const max = useMemo(() => {
    if (widget.maxValue !== null && widget.maxValue > 0) return widget.maxValue;
    const largest = Math.max(0, ...values);
    return largest > 0 ? largest : 1;
  }, [widget.maxValue, values]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-1.5 text-ink-muted">
        <HugeiconsIcon icon={InboxIcon} className="h-5 w-5" />
        <p className="text-sm">No data to display</p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col gap-4 overflow-y-auto", THIN_SCROLLBAR_CLASS)}>
      {rows.map((row, index) => {
        const value = values[index];
        const percent = Math.min(100, Math.max(0, (value / max) * 100));
        const label =
          widget.labelField !== null && row[widget.labelField] !== null && row[widget.labelField] !== undefined
            ? String(row[widget.labelField])
            : `Item ${index + 1}`;

        return (
          <div key={index} className="shrink-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink">{label}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">{formatNumber(value)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300 ease-out",
                    BAR_GRADIENTS[index % BAR_GRADIENTS.length],
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-muted">
                {Math.round(percent)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
