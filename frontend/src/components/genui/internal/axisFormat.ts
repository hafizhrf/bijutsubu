import { isIsoDateString } from "@/components/ui/data-cell";
import type { WidgetRow } from "@/types/dashboard";

export interface TimeAxisFormat {
  /** Compact tick label for the x axis. */
  tick: (value: unknown) => string;
  /** Fuller label for the tooltip header. */
  label: (value: unknown) => string;
}

type Bucket = "year" | "quarter" | "month" | "day";

const MONTH_UTC: Intl.DateTimeFormatOptions = { month: "short", timeZone: "UTC" };

function inferBucket(dates: Date[]): Bucket {
  // $dateTrunc emits UTC period starts, so the bucket size is recoverable
  // from which boundaries every value sits on.
  const allMidnight = dates.every(
    (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0,
  );
  if (!allMidnight) return "day";
  if (dates.every((d) => d.getUTCDate() === 1)) {
    if (dates.every((d) => d.getUTCMonth() === 0)) return "year";
    if (dates.every((d) => d.getUTCMonth() % 3 === 0)) return "quarter";
    return "month";
  }
  return "day";
}

/**
 * When a chart's x values are ISO date strings (date-bucketed groupBy results
 * serialize as ISO), returns tick/tooltip formatters matched to the bucket
 * size ("2026", "Q1 2026", "Mar 2026", "Mar 3"). Returns null for
 * non-temporal axes so charts render values as-is.
 */
export function buildTimeAxisFormat(rows: WidgetRow[], xField: string): TimeAxisFormat | null {
  const values = rows.map((row) => row[xField]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0 || !values.every(isIsoDateString)) return null;

  const dates = values.map((v) => new Date(v));
  const bucket = inferBucket(dates);
  const spansYears = new Set(dates.map((d) => d.getUTCFullYear())).size > 1;

  const format = (value: unknown, long: boolean): string => {
    if (!isIsoDateString(value)) return String(value ?? "");
    const d = new Date(value);
    const year = d.getUTCFullYear();
    switch (bucket) {
      case "year":
        return String(year);
      case "quarter":
        return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${year}`;
      case "month":
        return `${d.toLocaleString("en-US", MONTH_UTC)} ${year}`;
      case "day": {
        const day = `${d.toLocaleString("en-US", MONTH_UTC)} ${d.getUTCDate()}`;
        return long || spansYears ? `${day}, ${year}` : day;
      }
    }
  };

  return {
    tick: (value) => format(value, false),
    label: (value) => format(value, true),
  };
}
