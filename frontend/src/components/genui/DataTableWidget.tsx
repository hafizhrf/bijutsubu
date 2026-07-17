import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  DataCellValue,
  THIN_SCROLLBAR_CLASS,
  isIsoDateString,
  isNumericColumn,
} from "@/components/ui/data-cell";
import { csvCellText, downloadCsv, toCsv } from "@/lib/download";
import type { DataTableWidget as DataTableWidgetSpec, WidgetRow } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Download01Icon,
  InboxIcon,
} from "@hugeicons/core-free-icons";

interface DataTableWidgetProps {
  widget: DataTableWidgetSpec;
  rows: WidgetRow[];
}

const PAGE_SIZE = 15;
const PILL_MAX_LENGTH = 16;
const PILL_MAX_DISTINCT = 6;

/** Pastel pill palette: tinted background + matching darker text (lighter in dark mode). */
const PILL_CLASSES = [
  "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
] as const;

/** Stable string hash (djb2) so a given value always lands on the same pill color. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

function StatusPill({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        PILL_CLASSES[hashString(value) % PILL_CLASSES.length],
      )}
    >
      {value}
    </span>
  );
}

/**
 * A column reads as a "status" column when every present value is a short,
 * non-date string and the distinct-value count among current rows is low.
 */
function isStatusColumn(values: unknown[]): boolean {
  const distinct = new Set<string>();
  let sampled = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") return false;
    if (value.length > PILL_MAX_LENGTH || isIsoDateString(value)) return false;
    distinct.add(value);
    sampled += 1;
    if (distinct.size > PILL_MAX_DISTINCT) return false;
  }
  return sampled > 0;
}

export function DataTableWidget({ widget, rows }: DataTableWidgetProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const statusColumns = useMemo(() => {
    const status = new Set<string>();
    for (const column of widget.columns) {
      if (isStatusColumn(rows.map((row) => row[column.field]))) {
        status.add(column.field);
      }
    }
    return status;
  }, [widget.columns, rows]);

  const columns = useMemo<ColumnDef<WidgetRow>[]>(
    () =>
      widget.columns.map((column) => ({
        id: column.field,
        header: column.label,
        accessorFn: (row) => row[column.field],
        sortUndefined: "last",
        cell: (info) => {
          const value = info.getValue();
          if (statusColumns.has(column.field) && typeof value === "string" && value !== "") {
            return <StatusPill value={value} />;
          }
          return <DataCellValue value={value} />;
        },
      })),
    [widget.columns, statusColumns],
  );

  const numericColumns = useMemo(() => {
    const numeric = new Set<string>();
    for (const column of widget.columns) {
      if (isNumericColumn(rows.map((row) => row[column.field]))) {
        numeric.add(column.field);
      }
    }
    return numeric;
  }, [widget.columns, rows]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const exportCsv = () => {
    // Export follows the current sort order, all pages.
    const sorted = table.getSortedRowModel().rows;
    const csv = toCsv(
      widget.columns.map((c) => c.label),
      sorted.map((row) => widget.columns.map((c) => csvCellText(row.original[c.field]))),
    );
    downloadCsv(csv, `${widget.title.replace(/[^\w-]+/g, "-").toLowerCase() || "table"}.csv`);
  };

  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const firstRow = rows.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const lastRow = Math.min(rows.length, (pageIndex + 1) * PAGE_SIZE);

  return (
    <div className="flex h-full flex-col gap-2">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-2xl border border-border-soft bg-surface",
          THIN_SCROLLBAR_CLASS,
        )}
      >
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-muted/50 backdrop-blur-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]",
                        numericColumns.has(header.column.id) && "text-right",
                      )}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink",
                          sortDir && "text-ink",
                        )}
                        aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDir === "asc" && <HugeiconsIcon icon={ArrowUp01Icon} className="h-3 w-3" />}
                        {sortDir === "desc" && <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border-soft">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-surface-muted/60">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "px-4 py-3 text-sm text-ink",
                      numericColumns.has(cell.column.id) && "text-right",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="flex animate-fade-in flex-col items-center gap-1.5 px-4 py-10 text-ink-muted">
            <HugeiconsIcon icon={InboxIcon} className="h-5 w-5" />
            <p className="text-sm">No data to display</p>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-ink-muted">
          <p>
            {pageCount > 1 ? (
              <>
                <span className="font-semibold text-violet-500">
                  {firstRow.toLocaleString()}–{lastRow.toLocaleString()}
                </span>{" "}
                of {rows.length.toLocaleString()} rows
              </>
            ) : (
              <>
                <span className="font-semibold text-violet-500">{rows.length.toLocaleString()}</span>{" "}
                {rows.length === 1 ? "row" : "rows"}
              </>
            )}
          </p>
          <div className="flex items-center gap-1">
            {pageCount > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-12 text-center tabular-nums">
                  {pageIndex + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
                  aria-label="Next page"
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={exportCsv}
              className="ml-1 inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-surface-muted hover:text-ink"
              aria-label="Download CSV"
              title="Download CSV"
            >
              <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
