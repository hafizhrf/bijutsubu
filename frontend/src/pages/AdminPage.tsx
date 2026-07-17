import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activateAdminUser, getAdminOverview, getAdminUsers, suspendAdminUser } from "@/api/admin";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/authStore";

function sourceStatus(status: string | null) {
  return status === "error"
    ? { label: "Sync failed", dot: "bg-rose-500", badge: "bg-rose-500/10 text-rose-600 dark:text-rose-300" }
    : { label: "Healthy", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const currentUserId = useAuthStore((state) => state.user?.id);
  const overviewQuery = useQuery({ queryKey: ["admin", "overview"], queryFn: getAdminOverview });
  const usersQuery = useQuery({ queryKey: ["admin", "users", query], queryFn: () => getAdminUsers(query) });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin"] }); };
  const suspend = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => suspendAdminUser(id, reason), onSuccess: refresh });
  const activate = useMutation({ mutationFn: activateAdminUser, onSuccess: refresh });

  return <div>
    <TopBar title="Admin" />
    <div className="mt-5 space-y-5">
      {overviewQuery.data && <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Object.entries(overviewQuery.data.metrics).map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="capitalize text-xs text-ink-muted">{label.replace(/([A-Z])/g, " $1")}</p><p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p></CardContent></Card>)}
      </div>}

      <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>Users</CardTitle><Input className="max-w-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email or name" /></CardHeader><CardContent className="space-y-2">
        {usersQuery.data?.items.map(({ user, metrics }) => <div key={user.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-soft p-3"><div className="min-w-48 flex-1"><p className="font-medium text-ink">{user.displayName}</p><p className="text-xs text-ink-muted">{user.email}</p></div><p className="text-xs text-ink-muted">{metrics.collections} collections · {metrics.sources} sources</p>{user.suspendedAt ? <Button size="sm" onClick={() => activate.mutate(user.id)}>Activate</Button> : user.id === currentUserId ? <span className="text-xs font-medium text-ink-muted">Current admin</span> : <><Input className="h-8 w-48" value={reasons[user.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="Suspend reason"/><Button size="sm" variant="destructive" disabled={(reasons[user.id] ?? "").trim().length < 3} onClick={() => suspend.mutate({ id: user.id, reason: reasons[user.id] })}>Suspend</Button></>}</div>)}
      </CardContent></Card>

      {overviewQuery.data?.suspendedAccounts.length ? <Card><CardHeader><CardTitle>Suspended accounts</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{overviewQuery.data.suspendedAccounts.map((user) => <div key={user.id} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3"><p className="font-medium text-ink">{user.displayName}</p><p className="text-xs text-ink-muted">{user.email}</p><p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{user.suspensionReason ?? "Suspended"}</p></div>)}</CardContent></Card> : null}

      <Card><CardHeader><div><CardTitle>Source health</CardTitle><p className="mt-1 text-sm text-ink-muted">Connected databases across all workspaces.</p></div></CardHeader><CardContent>
        {overviewQuery.data?.sourceHealth.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{overviewQuery.data.sourceHealth.map(({ user, source }) => {
          const status = sourceStatus(source.lastSyncStatus);
          return <article key={source.id} className="rounded-2xl border border-border-soft bg-surface p-4 transition-colors hover:bg-surface-muted/60"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{source.name}</p><p className="mt-0.5 font-mono text-[11px] text-ink-muted">{source.engine} · {source.database}:{source.port}</p></div><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${status.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span></div><div className="mt-4 border-t border-border-soft pt-3 text-xs"><p className="truncate text-ink-muted">Owner <span className="text-ink">{user.email}</span></p><div className="mt-2 flex items-center justify-between text-ink-muted"><span>{source.tableCount} synced tables</span><span>{source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : "Not synced"}</span></div>{source.lastSyncStatus === "error" && <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-rose-600 dark:text-rose-300">{source.lastSyncError ?? "Sync failed"}</p>}</div></article>;
        })}</div> : <div className="rounded-2xl border border-dashed border-border-soft px-5 py-10 text-center text-sm text-ink-muted">No connected sources.</div>}
      </CardContent></Card>
    </div>
  </div>;
}