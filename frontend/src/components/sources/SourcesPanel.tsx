import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  CloudServerIcon,
  Delete02Icon,
  Loading03Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { deleteSource, getSources, syncSourceNow, updateSource } from "@/api/sources";
import type { DataSource } from "@/api/sources";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceDialog } from "@/components/sources/SourceDialog";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { useNotificationStore } from "@/store/notificationStore";

const ENGINE_LABELS: Record<DataSource["engine"], string> = {
  mysql: "MySQL/MariaDB",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
};

const SYNC_ERROR_LABELS: Record<string, string> = {
  auth_failed: "authentication failed",
  unreachable: "server unreachable",
  unknown_database: "database missing",
  timeout: "timed out",
  table_not_found: "table missing",
  target_conflict: "collection name conflict",
  query_failed: "query failed",
  private_host_blocked: "host blocked",
};

function StatusDot({ source }: { source: DataSource }) {
  if (source.syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" /> syncing…
      </span>
    );
  }
  if (source.lastSyncStatus === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-rose-500">
        <span className="h-2 w-2 rounded-full bg-rose-500" />
        {SYNC_ERROR_LABELS[source.lastSyncError ?? ""] ?? "sync failed"}
      </span>
    );
  }
  if (source.lastSyncStatus === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        synced {source.lastSyncAt ? timeAgo(new Date(source.lastSyncAt).getTime()) : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="h-2 w-2 rounded-full bg-border-soft" /> first sync pending
    </span>
  );
}

function SourceRow({ source }: { source: DataSource }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invalidateData = () => {
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["relations"] });
  };

  const syncMutation = useMutation({
    mutationFn: () => syncSourceNow(source._id),
    onSuccess: (result) => {
      const rows = result.tables.reduce((sum, table) => sum + table.rows, 0);
      useNotificationStore.getState().push({
        kind: result.ok ? "success" : "error",
        title: result.ok ? "Source synced" : "Sync failed",
        body: `${source.name} — ${result.tables.filter((t) => t.status === "ok").length} tables, ${rows.toLocaleString()} rows`,
        link: "/documents?tab=sources",
      });
      invalidateData();
    },
    onError: () => invalidateData(),
  });

  const intervalMutation = useMutation({
    mutationFn: (minutes: number) => updateSource(source._id, { syncIntervalMinutes: minutes }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSource(source._id),
    onSuccess: () => {
      setConfirmOpen(false);
      invalidateData();
    },
  });

  const busy = source.syncing || syncMutation.isPending;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-soft bg-surface p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink">
        <HugeiconsIcon icon={CloudServerIcon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{source.name}</p>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {ENGINE_LABELS[source.engine]}
          </span>
        </div>
        <p className="truncate font-mono text-xs text-ink-muted">
          {source.username ? `${source.username}@` : ""}{source.host}:{source.port}/{source.database}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <StatusDot source={source} />
          <span className="text-xs text-ink-muted">{source.tables.filter((t) => t.enabled).length} tables</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          value={String(source.syncIntervalMinutes)}
          onValueChange={(value) => intervalMutation.mutate(Number(value))}
        >
          <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Manual only</SelectItem>
            <SelectItem value="5">Every 5 min</SelectItem>
            <SelectItem value="15">Every 15 min</SelectItem>
            <SelectItem value="60">Every hour</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={busy}>
          <HugeiconsIcon icon={busy ? Loading03Icon : ArrowReloadHorizontalIcon} className={cn("h-4 w-4", busy && "animate-spin")} />
          Sync now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-rose-600 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
          onClick={() => setConfirmOpen(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect source</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-ink">{source.name}</span> will stop syncing. The
              collections it created stay in your workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Sources" tab body: connected databases + the connect wizard. */
export function SourcesPanel() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: getSources,
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.syncing) ? 4_000 : 30_000,
  });
  const sources = sourcesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Connected databases</CardTitle>
            <CardDescription>
              Live MySQL/MariaDB, PostgreSQL, or MongoDB servers that sync into your collections.
              Read-only credentials are recommended; passwords are encrypted at rest.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <HugeiconsIcon icon={PlusSignIcon} className="h-4 w-4" /> Connect database
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {sourcesQuery.isLoading && <p className="text-sm text-ink-muted">Loading sources…</p>}
          {!sourcesQuery.isLoading && sources.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-soft px-6 py-10 text-center">
              <HugeiconsIcon icon={CloudServerIcon} className="h-6 w-6 text-ink-muted" />
              <p className="text-sm font-medium text-ink">No databases connected yet</p>
              <p className="max-w-sm text-xs text-ink-muted">
                Connect a server and its tables become collections that refresh automatically on a
                schedule you pick.
              </p>
            </div>
          )}
          {sources.map((source) => (
            <SourceRow key={source._id} source={source} />
          ))}
          {sources.some((source) => source.lastSyncStatus === "error") && (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <HugeiconsIcon icon={Alert02Icon} className="h-3.5 w-3.5" />
              Failed tables keep their last synced data; fix the connection and sync again.
            </p>
          )}
        </CardContent>
      </Card>

      {dialogOpen && <SourceDialog open onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
