import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { csvCellText, downloadCsv, toCsv } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { DataCellValue, THIN_SCROLLBAR_CLASS, isNumericColumn } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Download01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

const PAGE_SIZE = 20;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface CustomTableResultViewProps {
  title: string;
  columns: { field: string; label: string }[];
  rows: Record<string, unknown>[];
  /** Extra toolbar actions rendered next to search/CSV (e.g. Save, Export menu). */
  actions?: ReactNode;
  /** Hide the built-in client CSV button (when a server export menu replaces it). */
  hideCsvButton?: boolean;
}

/**
 * Shared read-only result table for NL custom tables (fresh runs and saved
 * ones): client-side search, pagination, and CSV download over given rows.
 */
export function CustomTableResultView({
  title,
  columns,
  rows,
  actions,
  hideCsvButton = false,
}: CustomTableResultViewProps) {
  const [search, setSearch] = useState("");
  const [pageState, setPageState] = useState(0);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      columns.some((column) => csvCellText(row[column.field]).toLowerCase().includes(query)),
    );
  }, [rows, columns, search]);

  const maxPage = Math.max(0, Math.ceil(filteredRows.length / PAGE_SIZE) - 1);
  const page = Math.min(pageState, maxPage);
  const pageRows = filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const from = filteredRows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + pageRows.length;

  const numericColumns = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => isNumericColumn(rows.map((row) => row[column.field])))
          .map((column) => column.field),
      ),
    [columns, rows],
  );

  function handleDownload() {
    const header = columns.map((column) => column.label);
    const data = filteredRows.map((row) => columns.map((column) => csvCellText(row[column.field])));
    downloadCsv(toCsv(header, data), `${slugify(title) || "custom-table"}.csv`);
  }

  return (
    <div className="flex animate-fade-in flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative w-56">
            <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPageState(0);
              }}
              placeholder="Search results…"
              className="h-8 w-full rounded-full border border-border-soft bg-surface pl-8 pr-8 text-sm text-ink placeholder:text-ink-muted transition-[border-color,box-shadow] duration-200 focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPageState(0);
                }}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {!hideCsvButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleDownload}
              disabled={filteredRows.length === 0}
              title="Download the results below as CSV"
            >
              <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" /> CSV
            </Button>
          )}
          {actions}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-soft bg-surface-muted/40 px-4 py-8 text-center text-xs text-ink-muted">
          {rows.length === 0
            ? "The query ran but returned no rows."
            : `Nothing matches “${search.trim()}”.`}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-border-soft">
            <div className={cn("max-h-[42vh] overflow-auto", THIN_SCROLLBAR_CLASS)}>
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column.field}
                        className={cn(
                          "whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]",
                          numericColumns.has(column.field) && "text-right",
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {pageRows.map((row, index) => (
                    <tr
                      key={page * PAGE_SIZE + index}
                      className="transition-colors hover:bg-surface-muted/60"
                    >
                      {columns.map((column) => (
                        <td
                          key={column.field}
                          className={cn(
                            "px-4 py-2 text-sm text-ink",
                            numericColumns.has(column.field) && "text-right",
                          )}
                        >
                          <DataCellValue value={row[column.field]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-xs tabular-nums text-ink-muted">
              {from.toLocaleString()}–{to.toLocaleString()} of{" "}
              {filteredRows.length.toLocaleString()}
              {search.trim() && ` (filtered from ${rows.length.toLocaleString()})`}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 rounded-full p-0"
                disabled={page === 0}
                onClick={() => setPageState(page - 1)}
                title="Previous page"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 rounded-full p-0"
                disabled={page >= maxPage}
                onClick={() => setPageState(page + 1)}
                title="Next page"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
