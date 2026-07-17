import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSavedCustomTable,
  exportSavedCustomTable,
  getSavedCustomTable,
  getSavedCustomTables,
  renameSavedCustomTable,
} from "@/api/collections";
import type { ExportFormat, SavedCustomTableSummary } from "@/api/collections";
import { downloadBlob } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Lottie } from "@/components/ui/lottie";
import loadingAnimation from "@/assets/lottie/loading.lottie";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CustomTableResultView, slugify } from "@/components/collections/CustomTableResultView";
import { formatIsoDate } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Bookmark01Icon,
  Delete02Icon,
  Download01Icon,
  Loading03Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

function SavedTableRow({
  table,
  onOpen,
  onDelete,
}: {
  table: SavedCustomTableSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(table.name);

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameSavedCustomTable(table._id, name),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["custom-tables"] });
    },
  });

  function submitRename() {
    const name = nameInput.trim();
    if (!name || name === table.name) {
      setEditing(false);
      return;
    }
    renameMutation.mutate(name);
  }

  return (
    <li className="group flex items-center gap-3 rounded-2xl border border-border-soft bg-surface p-3.5 transition-colors hover:border-accent-blue/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
        <HugeiconsIcon icon={Bookmark01Icon} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex max-w-md items-center gap-2">
            <Input
              autoFocus
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
                if (event.key === "Escape") setEditing(false);
              }}
              className="h-8 text-sm"
            />
            <Button size="sm" className="h-8" onClick={submitRename} disabled={renameMutation.isPending}>
              {renameMutation.isPending ? (
                <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HugeiconsIcon icon={Tick02Icon} className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        ) : (
          <p className="truncate text-sm font-medium text-ink">{table.name}</p>
        )}
        <p className="truncate text-xs text-ink-muted" title={table.prompt}>
          {table.prompt}
        </p>
      </div>
      <span className="hidden shrink-0 text-xs text-ink-muted sm:block" title={table.createdAt}>
        {formatIsoDate(table.createdAt)}
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title="Rename"
          onClick={() => {
            setNameInput(table.name);
            setEditing(true);
          }}
          className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Delete"
          onClick={onDelete}
          className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
        </button>
      </div>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={onOpen}>
        Open <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/**
 * Saved NL custom tables under the collections workspace: list, open
 * (re-executes the stored DSL live), rename, delete, and multi-format export.
 */
export function SavedCustomTables() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedCustomTableSummary | null>(null);

  const listQuery = useQuery({ queryKey: ["custom-tables"], queryFn: getSavedCustomTables });
  const tables = listQuery.data ?? [];

  const detailQuery = useQuery({
    queryKey: ["custom-tables", "detail", openId],
    queryFn: () => getSavedCustomTable(openId!),
    enabled: openId !== null,
  });

  const exportMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format: ExportFormat }) =>
      exportSavedCustomTable(id, format).then((blob) => ({ blob, format })),
    onSuccess: ({ blob, format }) => {
      const name = detailQuery.data ? slugify(detailQuery.data.name) : "custom-table";
      downloadBlob(blob, `${name || "custom-table"}.${format}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedCustomTable(id),
    onSuccess: (_data, id) => {
      setDeleteTarget(null);
      if (openId === id) setOpenId(null);
      void queryClient.invalidateQueries({ queryKey: ["custom-tables"] });
    },
  });

  // The section stays invisible until the user has saved at least one table.
  if (listQuery.isLoading || tables.length === 0) return null;

  return (
    <Card className="mt-5 animate-fade-in-up">
      <CardHeader className="p-6 pb-3">
        <CardTitle className="text-base">Saved custom tables</CardTitle>
        <p className="text-xs text-ink-muted">
          Saved prompts re-run on your current data every time you open them.
        </p>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        <ul className="flex flex-col gap-2">
          {tables.map((table) => (
            <SavedTableRow
              key={table._id}
              table={table}
              onOpen={() => setOpenId(table._id)}
              onDelete={() => setDeleteTarget(table)}
            />
          ))}
        </ul>
      </CardContent>

      <Dialog open={openId !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="w-full max-w-[min(64rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{detailQuery.data?.name ?? "Saved table"}</DialogTitle>
            <DialogDescription>
              {detailQuery.data?.prompt ?? "Re-running the saved query on current data…"}
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Lottie src={loadingAnimation} className="h-14 w-14" />
              <p className="text-xs text-ink-muted">Running the saved query…</p>
            </div>
          )}
          {detailQuery.isError && (
            <p className="py-8 text-center text-sm text-rose-600">
              Could not run this saved table — a referenced collection may have been deleted.
            </p>
          )}
          {detailQuery.data && (
            <CustomTableResultView
              title={detailQuery.data.title}
              columns={detailQuery.data.columns}
              rows={detailQuery.data.rows}
              hideCsvButton
              actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={exportMutation.isPending}
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
                    <DropdownMenuItem
                      onSelect={() => openId && exportMutation.mutate({ id: openId, format: "csv" })}
                    >
                      CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => openId && exportMutation.mutate({ id: openId, format: "xlsx" })}
                    >
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => openId && exportMutation.mutate({ id: openId, format: "json" })}
                    >
                      JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete saved table</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-ink">{deleteTarget?.name}</span> from
              your saved tables. Your data is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget._id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
