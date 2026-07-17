import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  deleteRow,
  deleteRowsBulk,
  exportCollectionRows,
  getRelations,
  getRows,
  insertRow,
  updateRow,
} from "@/api/collections";
import type { ColumnFilter, ExportFormat, RowsQueryOptions } from "@/api/collections";
import { downloadBlob } from "@/lib/download";
import type { CollectionField, CollectionRowsResponse, RowRecord } from "@/types/collections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { EditableCell } from "@/components/datagrid/EditableCell";
import { RowEditorDialog } from "@/components/datagrid/RowEditorDialog";
import { RowDependencyWarning } from "@/components/datagrid/RowDependencyWarning";
import { SelectionTracker } from "@/components/datagrid/SelectionTracker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Delete02Icon,
  Download01Icon,
  EyeIcon,
  FilterHorizontalIcon,
  InboxIcon,
  Loading03Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SearchRemoveIcon,
} from "@hugeicons/core-free-icons";

const PAGE_SIZE = 50;

const HIDDEN_COLUMNS_KEY_PREFIX = "bijustubu-hidden-columns:";

function loadHiddenColumns(collectionName: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${HIDDEN_COLUMNS_KEY_PREFIX}${collectionName}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function persistHiddenColumns(collectionName: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(`${HIDDEN_COLUMNS_KEY_PREFIX}${collectionName}`, JSON.stringify([...hidden]));
  } catch {
    // localStorage full/unavailable — visibility just won't persist.
  }
}

type FilterOp = ColumnFilter["op"];

const FILTER_OPS_BY_TYPE: Record<string, { value: FilterOp; label: string }[]> = {
  string: [
    { value: "contains", label: "contains" },
    { value: "eq", label: "is" },
    { value: "ne", label: "is not" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "ne", label: "≠" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
  ],
  date: [
    { value: "gte", label: "on/after" },
    { value: "lte", label: "on/before" },
    { value: "gt", label: "after" },
    { value: "lt", label: "before" },
    { value: "eq", label: "on" },
  ],
  boolean: [
    { value: "eq", label: "is" },
    { value: "ne", label: "is not" },
  ],
};

function opsForType(type: string): { value: FilterOp; label: string }[] {
  return FILTER_OPS_BY_TYPE[type.toLowerCase()] ?? FILTER_OPS_BY_TYPE.string;
}

function opLabel(type: string, op: FilterOp): string {
  return opsForType(type).find((entry) => entry.value === op)?.label ?? op;
}

const HEADER_CELL_CLASS =
  "whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]";

const CHECKBOX_CLASS = "h-3.5 w-3.5 cursor-pointer accent-accent-blue";

/** Short human label for a row in the selection tray: its first non-empty field value. */
function rowLabel(row: RowRecord, fields: CollectionField[]): string {
  for (const field of fields) {
    const value = row[field.name];
    if (value === null || value === undefined || value === "") continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return `…${row._id.slice(-6)}`;
}

interface DataGridProps {
  collectionName: string;
  /** Controlled by the workspace header's "Add row" button. */
  draftOpen: boolean;
  onDraftOpenChange: (open: boolean) => void;
}

/** Inline field+op+value builder shown when the Filter toggle is open. */
function FilterBuilder({
  fields,
  onAdd,
}: {
  fields: CollectionField[];
  onAdd: (filter: ColumnFilter) => void;
}) {
  const [fieldName, setFieldName] = useState(fields[0]?.name ?? "");
  const selectedField = fields.find((f) => f.name === fieldName);
  const fieldType = (selectedField?.type ?? "string").toLowerCase();
  const ops = opsForType(fieldType);
  const [op, setOp] = useState<FilterOp>(ops[0]?.value ?? "contains");
  const [value, setValue] = useState("");

  function selectField(name: string) {
    setFieldName(name);
    const nextType = (fields.find((f) => f.name === name)?.type ?? "string").toLowerCase();
    setOp(opsForType(nextType)[0]?.value ?? "contains");
    setValue("");
  }

  function submit() {
    if (!fieldName) return;
    let coerced: string | number | boolean = value.trim();
    if (fieldType === "number") {
      const numeric = Number(coerced);
      if (coerced === "" || Number.isNaN(numeric)) return;
      coerced = numeric;
    } else if (fieldType === "boolean") {
      coerced = coerced === "true";
    } else if (coerced === "") {
      return;
    }
    onAdd({ field: fieldName, op, value: coerced });
    setValue("");
  }

  return (
    <div className="flex animate-fade-in flex-wrap items-center gap-2 rounded-2xl border border-border-soft bg-surface-muted/40 px-3 py-2.5">
      <Select value={fieldName} onValueChange={selectField}>
        <SelectTrigger className="h-8 w-44 rounded-full px-3 text-xs">
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.name} value={field.name}>
              {field.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={op} onValueChange={(next) => setOp(next as FilterOp)}>
        <SelectTrigger className="h-8 w-32 rounded-full px-3 text-xs">
          <SelectValue placeholder="Operator" />
        </SelectTrigger>
        <SelectContent>
          {ops.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fieldType === "boolean" ? (
        <Select value={value || "true"} onValueChange={setValue}>
          <SelectTrigger className="h-8 w-28 rounded-full px-3 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          type={fieldType === "number" ? "number" : "text"}
          placeholder={fieldType === "date" ? "e.g. 2026-01-31" : "Value…"}
          aria-label="Filter value"
          className="h-8 w-44 rounded-full border border-border-soft bg-surface px-3 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
        />
      )}
      <Button size="sm" className="h-8" onClick={submit}>
        <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" /> Add filter
      </Button>
    </div>
  );
}

/**
 * Paginated, inline-editable data grid for one collection with cross-page
 * multiselect. Mount with `key={collectionName}` so page + selection state
 * resets per collection.
 */
export function DataGrid({ collectionName, draftOpen, onDraftOpenChange }: DataGridProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  // Keyed by row _id, valued by a display label — survives page changes.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [editTarget, setEditTarget] = useState<RowRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RowRecord | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() =>
    loadHiddenColumns(collectionName),
  );
  const [pageInput, setPageInput] = useState("");
  const flashTimer = useRef<number | undefined>(undefined);

  // Debounced server-side search — resets to the first page of results.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const queryOptions: RowsQueryOptions = {
    search: debouncedSearch,
    ...(sort ? { sort: sort.field, sortDir: sort.dir } : {}),
    filters,
  };

  const rowsKey = [
    "collections",
    collectionName,
    "rows",
    page,
    debouncedSearch,
    sort,
    filters,
  ] as const;

  const rowsQuery = useQuery({
    queryKey: rowsKey,
    queryFn: () => getRows(collectionName, page * PAGE_SIZE, PAGE_SIZE, queryOptions),
    placeholderData: keepPreviousData,
  });

  function toggleSort(field: string) {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return null;
    });
    setPage(0);
  }

  function addFilter(filter: ColumnFilter) {
    setFilters((prev) => [...prev, filter]);
    setPage(0);
  }

  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setPage(0);
  }

  function toggleColumn(field: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      persistHiddenColumns(collectionName, next);
      return next;
    });
  }

  // Row editors render relation-backed fields as foreign-key pickers.
  const relationsQuery = useQuery({ queryKey: ["relations"], queryFn: getRelations });
  const relations = relationsQuery.data ?? [];

  const showFlash = useCallback((message: string) => {
    setFlashError(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashError(null), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // A freshly opened draft starts without a stale error from the previous attempt.
  useEffect(() => {
    if (draftOpen) setDraftError(null);
  }, [draftOpen]);

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["collections", collectionName, "rows"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
  }, [queryClient, collectionName]);

  const dropFromSelection = useCallback((ids: Iterable<string>) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const updateMutation = useMutation({
    mutationFn: ({ rowId, set }: { rowId: string; set: Record<string, unknown> }) =>
      updateRow(collectionName, rowId, set),
    onMutate: async ({ rowId, set }) => {
      await queryClient.cancelQueries({ queryKey: rowsKey });
      const previous = queryClient.getQueryData<CollectionRowsResponse>(rowsKey);
      queryClient.setQueryData<CollectionRowsResponse>(rowsKey, (old) =>
        old
          ? {
              ...old,
              rows: old.rows.map((row) => (row._id === rowId ? { ...row, ...set } : row)),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(rowsKey, context.previous);
      showFlash("Could not save that change — reverted.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rowsKey });
    },
  });

  const insertMutation = useMutation({
    mutationFn: (row: Record<string, unknown>) => insertRow(collectionName, row),
    onSuccess: () => {
      onDraftOpenChange(false);
      setDraftError(null);
      invalidateAll();
    },
    onError: () => setDraftError("Could not add the row. Check the values and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowId: string) => deleteRow(collectionName, rowId),
    onSuccess: (_data, rowId) => {
      setDeleteTarget(null);
      dropFromSelection([rowId]);
      const data = rowsQuery.data;
      if (data && data.rows.length === 1 && page > 0) setPage(page - 1);
      invalidateAll();
    },
    onError: () => {
      setDeleteTarget(null);
      showFlash("Could not delete that row.");
    },
  });

  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      exportCollectionRows(collectionName, format, queryOptions).then((blob) => ({ blob, format })),
    onSuccess: ({ blob, format }) => downloadBlob(blob, `${collectionName}.${format}`),
    onError: () => showFlash("Could not export this collection."),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteRowsBulk(collectionName, ids),
    onSuccess: ({ total }) => {
      setSelected(new Map());
      setBulkConfirmOpen(false);
      const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
      if (page > maxPage) setPage(maxPage);
      invalidateAll();
    },
    onError: () => {
      setBulkConfirmOpen(false);
      showFlash("Could not delete the selected rows.");
    },
  });

  if (rowsQuery.isLoading) {
    return (
      <div className="animate-fade-in overflow-hidden rounded-2xl border border-border-soft bg-surface">
        <div className="border-b border-border-soft px-4 py-2.5">
          <div className="h-3 w-2/5 animate-pulse rounded-full bg-surface-muted" />
        </div>
        <div className="divide-y divide-border-soft">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex animate-pulse items-center gap-4 px-4 py-3">
              <div className="h-3 w-16 rounded-full bg-surface-muted" />
              <div className="h-3 flex-1 rounded-full bg-surface-muted" />
              <div className="h-3 w-28 rounded-full bg-surface-muted" />
              <div className="h-3 w-20 rounded-full bg-surface-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rowsQuery.isError || !rowsQuery.data) {
    return (
      <p className="animate-fade-in py-12 text-center text-sm text-rose-600">
        Could not load rows for this collection.
      </p>
    );
  }

  const { fields: rawFields, rows, total, skip } = rowsQuery.data;
  const fields = rawFields.filter((field) => field.name !== "_id");
  const visibleFields = fields.filter((field) => !hiddenColumns.has(field.name));
  const numericFields = new Set(
    fields.filter((field) => field.type.toLowerCase() === "number").map((field) => field.name),
  );

  const from = rows.length === 0 ? 0 : skip + 1;
  const to = skip + rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const searching = debouncedSearch !== "" || filters.length > 0;
  // Truly empty collection vs. an active search/filter with no hits.
  const noRowsAtAll = total === 0 && !searching;
  const noMatches = total === 0 && searching;
  const showTable = !noRowsAtAll && !noMatches;

  function jumpToPage() {
    const target = Number(pageInput);
    if (!Number.isInteger(target) || target < 1 || target > pageCount) {
      setPageInput("");
      return;
    }
    setPage(target - 1);
    setPageInput("");
  }

  const allPageSelected = rows.length > 0 && rows.every((row) => selected.has(row._id));
  const somePageSelected = rows.some((row) => selected.has(row._id));

  function toggleRow(row: RowRecord) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row._id)) next.delete(row._id);
      else next.set(row._id, rowLabel(row, fields));
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allPageSelected) {
        for (const row of rows) next.delete(row._id);
      } else {
        for (const row of rows) next.set(row._id, rowLabel(row, fields));
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!noRowsAtAll && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative w-full max-w-xs">
              <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search rows…"
                className="h-8 w-full rounded-full border border-border-soft bg-surface pl-8 pr-8 text-sm text-ink placeholder:text-ink-muted transition-[border-color,box-shadow] duration-200 focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {rowsQuery.isFetching && (
              <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-muted" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8", (filterPanelOpen || filters.length > 0) && "border-accent-blue/40 text-accent-blue")}
              onClick={() => setFilterPanelOpen((open) => !open)}
              title="Filter by column"
            >
              <HugeiconsIcon icon={FilterHorizontalIcon} className="h-3.5 w-3.5" />
              Filter{filters.length > 0 && ` (${filters.length})`}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8" title="Show/hide columns">
                  <HugeiconsIcon icon={EyeIcon} className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                {fields.map((field) => (
                  <DropdownMenuCheckboxItem
                    key={field.name}
                    checked={!hiddenColumns.has(field.name)}
                    onCheckedChange={() => toggleColumn(field.name)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {field.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={exportMutation.isPending}
                  title={
                    searching
                      ? "Download the current view (search + filters applied)"
                      : "Download this collection"
                  }
                >
                  {exportMutation.isPending ? (
                    <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportMutation.mutate("csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportMutation.mutate("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportMutation.mutate("json")}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {!noRowsAtAll && filterPanelOpen && (
        <FilterBuilder fields={fields} onAdd={addFilter} />
      )}

      {!noRowsAtAll && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((filter, index) => {
            const fieldType = fields.find((f) => f.name === filter.field)?.type ?? "string";
            return (
              <span
                key={`${filter.field}-${filter.op}-${index}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent-blue/30 bg-accent-blue/5 py-1 pl-3 pr-1.5 text-xs text-ink"
              >
                <span className="font-medium">{filter.field}</span>
                <span className="text-ink-muted">{opLabel(fieldType, filter.op)}</span>
                <span className="font-medium">{String(filter.value)}</span>
                <button
                  type="button"
                  onClick={() => removeFilter(index)}
                  aria-label={`Remove filter on ${filter.field}`}
                  className="rounded-full p-0.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setFilters([]);
              setPage(0);
            }}
            className="text-xs text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {noRowsAtAll && (
        <div className="flex animate-fade-in flex-col items-center gap-2 rounded-2xl border border-dashed border-border-soft bg-surface-muted/40 px-6 py-14 text-center">
          <HugeiconsIcon icon={InboxIcon} className="h-6 w-6 text-ink-muted" />
          <p className="text-sm font-medium text-ink">No rows yet</p>
          <p className="text-xs text-ink-muted">
            This collection is empty. Add the first row to get started.
          </p>
          <Button size="sm" className="mt-2" onClick={() => onDraftOpenChange(true)}>
            <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" /> Add row
          </Button>
        </div>
      )}

      {noMatches && (
        <div className="flex animate-fade-in flex-col items-center gap-2 rounded-2xl border border-dashed border-border-soft bg-surface-muted/40 px-6 py-14 text-center">
          <HugeiconsIcon icon={SearchRemoveIcon} className="h-6 w-6 text-ink-muted" />
          <p className="text-sm font-medium text-ink">No matching rows</p>
          <p className="text-xs text-ink-muted">
            {debouncedSearch
              ? `Nothing matches “${debouncedSearch}”. Try a different search${filters.length > 0 ? " or remove a filter" : ""}.`
              : "No rows match the active filters. Try removing one."}
          </p>
        </div>
      )}

      {showTable && (
        <div className="animate-fade-in overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className={cn("max-h-[62vh] overflow-auto", THIN_SCROLLBAR_CLASS)}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th className={cn(HEADER_CELL_CLASS, "sticky left-0 z-20 w-10 bg-surface px-3")}>
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={togglePage}
                      className={CHECKBOX_CLASS}
                      aria-label="Select all rows on this page"
                    />
                  </th>
                  <th className={cn(HEADER_CELL_CLASS, "w-[90px]")}>_id</th>
                  {visibleFields.map((field) => (
                    <th
                      key={field.name}
                      className={cn(
                        HEADER_CELL_CLASS,
                        numericFields.has(field.name) && "text-right",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(field.name)}
                        title={`Sort by ${field.name}`}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink",
                          sort?.field === field.name && "text-ink",
                        )}
                      >
                        {field.name}
                        {sort?.field === field.name &&
                          (sort.dir === "asc" ? (
                            <HugeiconsIcon icon={ArrowUp01Icon} className="h-3 w-3" />
                          ) : (
                            <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3" />
                          ))}
                      </button>
                    </th>
                  ))}
                  {/* Zero-width sticky column hosting the floating per-row actions. */}
                  <th className={cn(HEADER_CELL_CLASS, "sticky right-0 w-0 p-0")}>
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((row, index) => {
                  const isSelected = selected.has(row._id);
                  return (
                    <tr
                      key={row._id}
                      style={{ "--stagger": `${Math.min(index, 10) * 20}ms` } as CSSProperties}
                      className={cn(
                        "group animate-fade-in transition-colors hover:bg-surface-muted/60",
                        isSelected && "bg-accent-blue/5 hover:bg-accent-blue/10",
                      )}
                    >
                      {/* Sticky needs an opaque background; these hexes approximate the row's
                          translucent surface-muted/accent tints composited over the surface. */}
                      <td
                        className={cn(
                          "sticky left-0 z-[5] w-10 bg-surface px-3 py-2.5 transition-colors group-hover:bg-[#faf9f7] dark:group-hover:bg-[#20202a]",
                          isSelected &&
                            "bg-[#f7f8ff] group-hover:bg-[#eff2fe] dark:bg-[#1d2030] dark:group-hover:bg-[#232741]",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row)}
                          className={CHECKBOX_CLASS}
                          aria-label="Select row"
                        />
                      </td>
                      <td className="w-[90px] px-4 py-2.5">
                        <span title={row._id} className="font-mono text-[11px] text-ink-muted">
                          …{row._id.slice(-6)}
                        </span>
                      </td>
                      {visibleFields.map((field) => (
                        <td
                          key={field.name}
                          className={cn(
                            "px-4 py-2.5 text-sm text-ink",
                            numericFields.has(field.name) && "text-right",
                          )}
                        >
                          <EditableCell
                            value={row[field.name]}
                            fieldType={field.type}
                            numeric={numericFields.has(field.name)}
                            onCommit={(next) =>
                              updateMutation.mutate({
                                rowId: row._id,
                                set: { [field.name]: next },
                              })
                            }
                          />
                        </td>
                      ))}
                      {/* Floating actions pinned to the container's right edge, shown on row hover. */}
                      <td className="sticky right-0 w-0 p-0">
                        <div className="pointer-events-none absolute inset-y-0 right-2 z-10 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border-soft bg-surface p-0.5 shadow-md">
                            <button
                              type="button"
                              title="Edit row"
                              onClick={() => setEditTarget(row)}
                              className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50"
                            >
                              <HugeiconsIcon icon={PencilEdit02Icon} className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Delete row"
                              disabled={deleteMutation.isPending}
                              onClick={() => setDeleteTarget(row)}
                              className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50 disabled:opacity-40"
                            >
                              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showTable && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="shrink-0 text-xs tabular-nums text-ink-muted">
            {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
          </p>
          <p
            aria-live="polite"
            className={cn(
              "flex min-w-0 items-center gap-1.5 truncate text-xs text-rose-600 transition-opacity",
              flashError ? "animate-fade-in opacity-100" : "opacity-0",
            )}
          >
            {flashError && <HugeiconsIcon icon={AlertCircleIcon} className="h-3.5 w-3.5 shrink-0" />}
            {flashError}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 rounded-full p-0"
              disabled={page === 0 || rowsQuery.isFetching}
              onClick={() => setPage(page - 1)}
              title="Previous page"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
            </Button>
            <span className="flex items-center gap-1 text-xs tabular-nums text-ink-muted">
              <input
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") jumpToPage();
                }}
                onBlur={() => setPageInput("")}
                placeholder={String(page + 1)}
                aria-label="Go to page"
                className="h-7 w-10 rounded-full border border-border-soft bg-surface text-center text-xs text-ink placeholder:text-ink-muted focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
              />
              / {pageCount.toLocaleString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 rounded-full p-0"
              disabled={to >= total || rowsQuery.isFetching}
              onClick={() => setPage(page + 1)}
              title="Next page"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {draftOpen && (
        <RowEditorDialog
          mode="create"
          fields={fields}
          collectionName={collectionName}
          relations={relations}
          saving={insertMutation.isPending}
          error={draftError}
          onClose={() => {
            onDraftOpenChange(false);
            setDraftError(null);
          }}
          onSave={(row) => insertMutation.mutate(row)}
        />
      )}

      {editTarget && (
        <RowEditorDialog
          key={editTarget._id}
          mode="edit"
          row={editTarget}
          fields={fields}
          collectionName={collectionName}
          relations={relations}
          saving={false}
          onClose={() => setEditTarget(null)}
          onSave={(set) => {
            // Optimistic update paints the grid instantly; the error flash reverts on failure.
            updateMutation.mutate({ rowId: editTarget._id, set });
            setEditTarget(null);
          }}
        />
      )}

      <SelectionTracker
        entries={[...selected.entries()].map(([id, label]) => ({ id, label }))}
        deleting={bulkDeleteMutation.isPending}
        onRemove={(id) => dropFromSelection([id])}
        onClear={() => setSelected(new Map())}
        onDeleteAll={() => setBulkConfirmOpen(true)}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete row</DialogTitle>
            <DialogDescription>
              This permanently deletes row{" "}
              <span className="font-mono text-xs text-ink">
                …{deleteTarget?._id.slice(-6)}
              </span>{" "}
              {deleteTarget && (
                <>
                  (<span className="font-medium text-ink">{rowLabel(deleteTarget, fields)}</span>){" "}
                </>
              )}
              from this collection. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <RowDependencyWarning
              collectionName={collectionName}
              ids={[deleteTarget._id]}
              enabled={deleteTarget !== null}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget._id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Delete row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete selected rows</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-medium text-ink">
                {selected.size.toLocaleString()} row{selected.size === 1 ? "" : "s"}
              </span>{" "}
              from this collection. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {bulkConfirmOpen && selected.size > 0 && (
            <RowDependencyWarning
              collectionName={collectionName}
              ids={[...selected.keys()]}
              enabled={bulkConfirmOpen}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate([...selected.keys()])}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Delete {selected.size.toLocaleString()} row{selected.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
