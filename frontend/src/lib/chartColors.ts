// Fixed categorical order (never cycled per-render) so a given series always
// maps to the same slot; vibrant modern-dashboard palette.
export const CHART_COLORS = [
  "#8b5cf6", // violet
  "#f59e0b", // orange
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#6366f1", // blue
  "#10b981", // emerald
] as const;

export function colorForIndex(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
