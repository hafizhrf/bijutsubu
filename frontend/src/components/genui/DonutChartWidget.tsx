import { PieBase } from "@/components/genui/internal/PieBase";
import type { DonutChartWidget as DonutChartWidgetSpec, WidgetRow } from "@/types/dashboard";

interface DonutChartWidgetProps {
  widget: DonutChartWidgetSpec;
  rows: WidgetRow[];
}

export function DonutChartWidget({ widget, rows }: DonutChartWidgetProps) {
  return <PieBase labelField={widget.labelField} valueField={widget.valueField} rows={rows} donut={true} />;
}
