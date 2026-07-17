import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useChartTheme } from "@/components/genui/internal/chartTheme";
import { colorForIndex } from "@/lib/chartColors";
import type { WidgetRow } from "@/types/dashboard";

interface PieBaseProps {
  labelField: string;
  valueField: string;
  rows: WidgetRow[];
  donut: boolean;
}

function toNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function PieBase({ labelField, valueField, rows, donut }: PieBaseProps) {
  const theme = useChartTheme();
  const legend = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + toNumber(row[valueField]), 0);
    return rows.map((row, index) => {
      const value = toNumber(row[valueField]);
      const percent = total > 0 ? (value / total) * 100 : 0;
      return {
        label: String(row[labelField] ?? "—"),
        percent: percent.toLocaleString("en-US", { maximumFractionDigits: 1 }),
        color: colorForIndex(index),
      };
    });
  }, [rows, labelField, valueField]);

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={theme.tooltipStyle} labelStyle={theme.tooltipLabelStyle} />
            <Pie
              data={rows}
              dataKey={valueField}
              nameKey={labelField}
              innerRadius={donut ? "52%" : 0}
              outerRadius="88%"
              paddingAngle={rows.length > 1 ? 2 : 0}
            >
              {rows.map((_, index) => (
                <Cell
                  key={index}
                  fill={colorForIndex(index)}
                  stroke={String(theme.tooltipStyle.backgroundColor ?? "#ffffff")}
                  strokeWidth={2}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      {legend.length > 0 && (
        <ul className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
          {legend.map((entry, index) => (
            <li key={index} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="max-w-32 truncate text-ink-muted">{entry.label}</span>
              <span className="font-semibold tabular-nums text-ink">{entry.percent}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
