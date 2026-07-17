import type { WidgetRow } from "@/types/dashboard";

interface SeriesSpec {
  xField: string;
  yField: string;
  seriesField: string | null;
}

/**
 * Pivots long-format rows into Recharts-friendly wide data.
 * Without a seriesField the y values chart as a single series; with one,
 * each distinct series value becomes its own data key.
 */
export function buildSeries(rows: WidgetRow[], spec: SeriesSpec) {
  const { xField, yField, seriesField } = spec;

  if (!seriesField) {
    return {
      chartData: rows.map((row) => ({ [xField]: row[xField], [yField]: row[yField] })),
      seriesKeys: [yField],
    };
  }

  const byX = new Map<string, WidgetRow>();
  const seriesKeys = new Set<string>();

  for (const row of rows) {
    const xValue = String(row[xField] ?? "");
    const seriesValue = String(row[seriesField] ?? "");
    seriesKeys.add(seriesValue);
    const entry = byX.get(xValue) ?? { [xField]: row[xField] };
    entry[seriesValue] = row[yField];
    byX.set(xValue, entry);
  }

  return { chartData: Array.from(byX.values()), seriesKeys: Array.from(seriesKeys) };
}
