import type { ReactNode } from "react";

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Thin, unobtrusive scrollbar for table scroll containers. */
export const THIN_SCROLLBAR_CLASS =
  "[scrollbar-width:thin] [scrollbar-color:var(--color-border-soft)_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-soft";

export function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_RE.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** True when a column's non-empty values are all numbers (drives right alignment). */
export function isNumericColumn(values: unknown[]): boolean {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  return present.length > 0 && present.every((v) => typeof v === "number");
}

/** Compact date display: "Jan 5, 2026" or "Jan 5, 2026, 14:30" when a time is present. */
export function formatIsoDate(value: string): string {
  const date = new Date(value);
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (value.length <= 10) return datePart;
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}

/**
 * Presentational smart cell: muted em dash for empty values, formatted numbers,
 * Yes/No pills for booleans, short dates for ISO strings, truncation for long text.
 */
export function DataCellValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-muted">—</span>;
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{value.toLocaleString()}</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">
        {value ? "Yes" : "No"}
      </span>
    );
  }
  if (isIsoDateString(value)) {
    return (
      <span className="whitespace-nowrap" title={value}>
        {formatIsoDate(value)}
      </span>
    );
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <span className="block max-w-[320px] truncate" title={text}>
      {text}
    </span>
  );
}
