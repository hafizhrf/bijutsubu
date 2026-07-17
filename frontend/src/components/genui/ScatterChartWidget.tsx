import { useMemo } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatAxisNumber, useChartTheme } from "@/components/genui/internal/chartTheme";
import { colorForIndex } from "@/lib/chartColors";
import type { ScatterChartWidget as ScatterChartWidgetSpec, WidgetRow } from "@/types/dashboard";

interface ScatterChartWidgetProps {
  widget: ScatterChartWidgetSpec;
  rows: WidgetRow[];
}

export function ScatterChartWidget({ widget, rows }: ScatterChartWidgetProps) {
  const points = useMemo(() => {
    const { xField, yField } = widget;
    return rows
      .map((row) => ({ [xField]: Number(row[xField]), [yField]: Number(row[yField]) }))
      .filter((point) => Number.isFinite(point[xField]) && Number.isFinite(point[yField]));
  }, [rows, widget]);

  const theme = useChartTheme();

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis
            type="number"
            dataKey={widget.xField}
            name={widget.xField}
            tick={theme.axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatAxisNumber}
          />
          <YAxis
            type="number"
            dataKey={widget.yField}
            name={widget.yField}
            tick={theme.axisTick}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={formatAxisNumber}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: theme.axisTick.fill }}
            contentStyle={theme.tooltipStyle}
            labelStyle={theme.tooltipLabelStyle}
          />
          <Scatter data={points} fill={colorForIndex(0)} fillOpacity={0.8} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
