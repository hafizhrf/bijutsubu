import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ComparePeriod, StatCardWidget, WidgetRow } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons";

interface StatCardProps {
  widget: StatCardWidget;
  rows: WidgetRow[];
  /** Bucketed trend rows delivered by the executor as "<id>::sparkline". */
  sparklineRows?: WidgetRow[];
  /** Position among the dashboard's stat cards; picks the gradient. */
  paletteIndex?: number;
}

/** Vibrant gradients cycled across the stat-card row (violet, blue, teal, orange). */
const GRADIENT_CLASSES = [
  "bg-gradient-to-br from-[#7c3aed] to-[#a78bfa]",
  "bg-gradient-to-br from-[#3b82f6] to-[#60a5fa]",
  "bg-gradient-to-br from-[#14b8a6] to-[#2dd4bf]",
  "bg-gradient-to-br from-[#f97316] to-[#fbbf24]",
] as const;

const PERIOD_LABEL: Record<ComparePeriod, string> = {
  day: "vs yesterday",
  week: "vs last week",
  month: "vs last month",
  quarter: "vs last quarter",
  year: "vs last year",
};

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatDelta(value: unknown): { label: string; positive: boolean } | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || Number.isNaN(numeric)) return null;
  const positive = numeric >= 0;
  const rounded = Math.round(numeric * 10) / 10;
  return { label: `${positive ? "+" : ""}${rounded}%`, positive };
}

/** Subtle corner decoration: two overlapping wavy strokes at low opacity. */
function WaveMotif() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 48"
      className="pointer-events-none absolute bottom-0 right-0 h-12 w-30 text-white/15"
      fill="none"
    >
      <path
        d="M0 34 C 20 18, 40 50, 60 34 S 100 18, 124 34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M0 44 C 20 28, 40 60, 60 44 S 100 28, 124 44"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g fill="currentColor">
        <circle cx="96" cy="12" r="1.5" />
        <circle cx="106" cy="12" r="1.5" />
        <circle cx="116" cy="12" r="1.5" />
        <circle cx="96" cy="20" r="1.5" />
        <circle cx="106" cy="20" r="1.5" />
        <circle cx="116" cy="20" r="1.5" />
      </g>
    </svg>
  );
}

/** Tiny inline trend line (plain SVG — no charting lib for a 100px line). */
function Sparkline({ values }: { values: number[] }) {
  const gradientId = useId();
  const { linePoints, areaPoints } = useMemo(() => {
    const width = 100;
    const height = 28;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const coords = values.map((v, i) => {
      const x = Math.round(i * step * 10) / 10;
      const y = Math.round((2 + (height - 4) * (1 - (v - min) / span)) * 10) / 10;
      return `${x},${y}`;
    });
    return {
      linePoints: coords.join(" "),
      areaPoints: `0,${height} ${coords.join(" ")} ${width},${height}`,
    };
  }, [values]);

  return (
    <svg aria-hidden="true" viewBox="0 0 100 28" className="h-7 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke="white"
        strokeOpacity="0.9"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatCard({ widget, rows, sparklineRows, paletteIndex = 0 }: StatCardProps) {
  const row = rows[0];
  const value = row?.[widget.valueField];
  const delta = widget.deltaField ? formatDelta(row?.[widget.deltaField]) : null;
  const gradient = GRADIENT_CLASSES[paletteIndex % GRADIENT_CLASSES.length];

  const sparkValues = useMemo(() => {
    if (!widget.sparkline || !sparklineRows) return null;
    const values = sparklineRows
      .map((r) => r[widget.valueField])
      .filter((v): v is number => typeof v === "number");
    return values.length >= 2 ? values : null;
  }, [widget.sparkline, widget.valueField, sparklineRows]);

  return (
    <div
      className={cn(
        "relative flex h-full flex-col justify-center gap-5 overflow-hidden rounded-card p-6 text-white shadow-card",
        gradient,
      )}
    >
      <WaveMotif />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-white/80">{widget.title}</p>
        {delta && (
          <span className="inline-flex items-center gap-0.5 rounded-pill bg-white/20 px-2.5 py-1 text-xs font-semibold text-white">
            {delta.positive ? <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-3 w-3" /> : <HugeiconsIcon icon={ArrowDownRight01Icon} className="h-3 w-3" />}
            {delta.label}
          </span>
        )}
      </div>
      <div className="relative flex flex-col gap-1.5">
        <p className="text-4xl font-bold tracking-tight text-white">{formatValue(value)}</p>
        {widget.compare && (
          <p className="text-xs font-medium text-white/70">{PERIOD_LABEL[widget.compare.period]}</p>
        )}
      </div>
      {sparkValues && (
        <div className="relative -mb-2">
          <Sparkline values={sparkValues} />
        </div>
      )}
    </div>
  );
}
