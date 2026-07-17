import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildTimeAxisFormat } from "@/components/genui/internal/axisFormat";
import { buildSeries } from "@/components/genui/internal/chartSeries";
import { formatAxisNumber, useChartTheme } from "@/components/genui/internal/chartTheme";
import { colorForIndex } from "@/lib/chartColors";
import type { LineChartWidget as LineChartWidgetSpec, WidgetRow } from "@/types/dashboard";

interface LineChartWidgetProps {
  widget: LineChartWidgetSpec;
  rows: WidgetRow[];
}

export function LineChartWidget({ widget, rows }: LineChartWidgetProps) {
  const { chartData, seriesKeys } = useMemo(() => buildSeries(rows, widget), [rows, widget]);
  const timeAxis = useMemo(() => buildTimeAxisFormat(chartData, widget.xField), [chartData, widget.xField]);
  const theme = useChartTheme();

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
          <XAxis dataKey={widget.xField} tick={theme.axisTick} tickLine={false} axisLine={false} tickFormatter={timeAxis?.tick} />
          <YAxis tick={theme.axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={formatAxisNumber} />
          <Tooltip contentStyle={theme.tooltipStyle} labelStyle={theme.tooltipLabelStyle} labelFormatter={timeAxis?.label} />
          {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
          {seriesKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={colorForIndex(index)}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff", fill: colorForIndex(index) }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
