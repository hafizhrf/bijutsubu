import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildTimeAxisFormat } from "@/components/genui/internal/axisFormat";
import { buildSeries } from "@/components/genui/internal/chartSeries";
import { formatAxisNumber, useChartTheme } from "@/components/genui/internal/chartTheme";
import { colorForIndex } from "@/lib/chartColors";
import type { BarChartWidget as BarChartWidgetSpec, WidgetRow } from "@/types/dashboard";

interface BarChartWidgetProps {
  widget: BarChartWidgetSpec;
  rows: WidgetRow[];
}

export function BarChartWidget({ widget, rows }: BarChartWidgetProps) {
  const { chartData, seriesKeys } = useMemo(() => buildSeries(rows, widget), [rows, widget]);
  const timeAxis = useMemo(() => buildTimeAxisFormat(chartData, widget.xField), [chartData, widget.xField]);
  const theme = useChartTheme();

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
          <XAxis dataKey={widget.xField} tick={theme.axisTick} tickLine={false} axisLine={false} tickFormatter={timeAxis?.tick} />
          <YAxis tick={theme.axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={formatAxisNumber} />
          <Tooltip
            cursor={{ fill: "rgba(139,92,246,0.06)" }}
            contentStyle={theme.tooltipStyle}
            labelStyle={theme.tooltipLabelStyle}
            labelFormatter={timeAxis?.label}
          />
          {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
          {seriesKeys.map((key, index) => (
            <Bar key={key} dataKey={key} name={key} fill={colorForIndex(index)} radius={[6, 6, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
