import { PieBase } from "@/components/genui/internal/PieBase";
import type { PieChartWidget as PieChartWidgetSpec, WidgetRow } from "@/types/dashboard";

interface PieChartWidgetProps {
  widget: PieChartWidgetSpec;
  rows: WidgetRow[];
}

export function PieChartWidget({ widget, rows }: PieChartWidgetProps) {
  return <PieBase labelField={widget.labelField} valueField={widget.valueField} rows={rows} donut={false} />;
}
