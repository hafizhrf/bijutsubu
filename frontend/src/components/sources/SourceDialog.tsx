import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, CloudServerIcon, Key01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { createSource, testSourceConnection } from "@/api/sources";
import type { SourceEngine, SourceTableSummary } from "@/api/sources";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useNotificationStore } from "@/store/notificationStore";

const DEFAULT_PORTS: Record<SourceEngine, number> = { mysql: 3306, postgres: 5432, mongodb: 27017 };
const ENGINE_LABELS: Record<SourceEngine, string> = {
  mysql: "MySQL / MariaDB",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
};

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Authentication failed — check the username and password.",
  unreachable: "Could not reach the server — check host and port.",
  unknown_database: "That database doesn't exist on the server.",
  timeout: "The connection timed out.",
  private_host_blocked: "Connecting to private/internal hosts is disabled on this deployment.",
  query_failed: "Connected, but reading the schema failed.",
  source_limit_reached: "You've reached the maximum number of connected sources.",
  unknown_tables: "Some selected tables no longer exist on the server.",
};

function errorMessageOf(error: unknown): string {
  if (isAxiosError(error)) {
    const code = (error.response?.data as { error?: string } | undefined)?.error;
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  }
  return "Something went wrong — try again.";
}

/**
 * Two-step connect wizard: (1) connection details gated by a successful
 * "Test connection", (2) pick tables + sync interval. Nothing is stored until
 * the final step; the password is sent only to the backend, never kept in
 * any client store.
 */
export function SourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [engine, setEngine] = useState<SourceEngine>("mysql");
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(String(DEFAULT_PORTS.mysql));
  const [portTouched, setPortTouched] = useState(false);
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [tables, setTables] = useState<SourceTableSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [interval, setIntervalMinutes] = useState("15");

  const connection = useMemo(
    () => ({
      engine,
      host: host.trim(),
      port: Number(port) || DEFAULT_PORTS[engine],
      database: database.trim(),
      username: username.trim(),
      password,
      ssl,
    }),
    [engine, host, port, database, username, password, ssl],
  );

  const testMutation = useMutation({
    mutationFn: () => testSourceConnection(connection),
    onSuccess: (result) => {
      setTables(result.tables);
      setSelected(new Set(result.tables.map((table) => table.name)));
      setStep(2);
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createSource({
        ...connection,
        name: name.trim() || `${ENGINE_LABELS[engine]} · ${connection.database}`,
        syncIntervalMinutes: Number(interval),
        tables: [...selected],
      }),
    onSuccess: (source) => {
      useNotificationStore.getState().push({
        kind: "success",
        title: "Source connected",
        body: `${source.name} — first sync is running in the background.`,
        link: "/documents?tab=sources",
      });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      onClose();
    },
  });

  function pickEngine(next: SourceEngine) {
    setEngine(next);
    if (!portTouched) setPort(String(DEFAULT_PORTS[next]));
  }

  const canTest =
    connection.host.length > 0 && connection.database.length > 0 && !testMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-full max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={CloudServerIcon} className="h-4.5 w-4.5" /> Connect a database
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Read-only access is enough — we only ever run SELECT queries. Using a read-only account is recommended."
              : "Pick the tables to sync into your workspace and how often to refresh them."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(ENGINE_LABELS) as SourceEngine[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => pickEngine(option)}
                  aria-pressed={engine === option}
                  className={cn(
                    "rounded-2xl border px-3 py-2.5 text-sm font-medium transition-all",
                    engine === option
                      ? "border-transparent bg-surface-muted text-ink ring-2 ring-accent-blue"
                      : "border-border-soft text-ink-muted hover:text-ink",
                  )}
                >
                  {ENGINE_LABELS[option]}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <div className="space-y-1.5"><Label htmlFor="src-host">Host</Label><Input id="src-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" /></div>
              <div className="space-y-1.5"><Label htmlFor="src-port">Port</Label><Input id="src-port" value={port} inputMode="numeric" onChange={(e) => { setPort(e.target.value); setPortTouched(true); }} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="src-db">Database</Label><Input id="src-db" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="db_penjualan" /></div>
              <div className="space-y-1.5"><Label htmlFor="src-name">Display name (optional)</Label><Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production sales DB" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="src-user">Username</Label><Input id="src-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></div>
              <div className="space-y-1.5"><Label htmlFor="src-pass">Password</Label><Input id="src-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={ssl} onChange={() => setSsl(!ssl)} className="h-3.5 w-3.5 accent-accent-blue" /> Use TLS/SSL
            </label>

            {testMutation.isError && (
              <p className="flex items-start gap-1.5 rounded-xl bg-rose-100/70 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorMessageOf(testMutation.error)}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => testMutation.mutate()} disabled={!canTest}>
                {testMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
                Test connection
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-muted">{selected.size} of {tables.length} tables selected</p>
              <button
                type="button"
                onClick={() => setSelected(selected.size === tables.length ? new Set() : new Set(tables.map((t) => t.name)))}
                className="text-xs font-medium text-accent-blue hover:underline"
              >
                {selected.size === tables.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
              {tables.map((table) => {
                const checked = selected.has(table.name);
                return (
                  <label key={table.name} className={cn("flex cursor-pointer items-center gap-2.5 rounded-2xl border px-3 py-2 transition-colors", checked ? "border-accent-blue/50 bg-surface-muted/60" : "border-border-soft hover:bg-surface-muted/40")}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(selected);
                        if (checked) next.delete(table.name); else next.add(table.name);
                        setSelected(next);
                      }}
                      className="h-3.5 w-3.5 accent-accent-blue"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{table.name}</span>
                    {table.pk && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-muted"><HugeiconsIcon icon={Key01Icon} className="h-3 w-3 text-amber-500" />{table.pk}</span>
                    )}
                    <span className="text-xs tabular-nums text-ink-muted">{table.approxRows === null ? "—" : `~${table.approxRows.toLocaleString()} rows`}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Label className="shrink-0">Auto-sync</Label>
              <Select value={interval} onValueChange={setIntervalMinutes}>
                <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Manual only</SelectItem>
                  <SelectItem value="5">Every 5 minutes</SelectItem>
                  <SelectItem value="15">Every 15 minutes</SelectItem>
                  <SelectItem value="60">Every hour</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createMutation.isError && (
              <p className="flex items-start gap-1.5 rounded-xl bg-rose-100/70 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorMessageOf(createMutation.error)}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => createMutation.mutate()} disabled={selected.size === 0 || createMutation.isPending}>
                {createMutation.isPending ? (
                  <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={Tick02Icon} className="h-4 w-4" />
                )}
                Connect &amp; import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
