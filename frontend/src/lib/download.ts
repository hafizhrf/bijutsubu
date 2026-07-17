/** Plain-text rendering of a cell value for CSV export. */
export function csvCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** RFC-4180-style CSV: cells with commas/quotes/newlines are quoted, quotes doubled. */
export function toCsv(header: string[], rows: string[][]): string {
  const escapeCell = (cell: string) =>
    /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Triggers a CSV file download; the BOM keeps Excel happy with UTF-8. */
export function downloadCsv(csv: string, filename: string): void {
  downloadBlob(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }), filename);
}
