import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  deleteCollection,
  getCollectionDependencies,
  getCollections,
  updateCollectionMeta,
} from "@/api/collections";
import { DependencyNote } from "@/components/ui/dependency-note";
import { getSources } from "@/api/sources";
import type { DataSource } from "@/api/sources";
import type { MetaCollection } from "@/types/collections";
import { TopBar } from "@/components/layout/TopBar";
import { RelationsTab } from "@/components/relations/RelationsTab";
import { DataGrid } from "@/components/datagrid/DataGrid";
import { FieldList } from "@/components/datagrid/FieldList";
import { CustomTableDialog } from "@/components/collections/CustomTableDialog";
import { SavedCustomTables } from "@/components/collections/SavedCustomTables";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Lottie } from "@/components/ui/lottie";
import emptyAstronaut from "@/assets/lottie/empty-astronaut.lottie";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CloudServerIcon,
  Database01Icon,
  Delete02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

const DOT_CLASSES = [
  "bg-accent-blue",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-400",
] as const;

/** Deterministic accent dot per collection so the rail reads like a database list. */
function collectionDotClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DOT_CLASSES[hash % DOT_CLASSES.length];
}

interface CollectionRailProps {
  collections: MetaCollection[];
  selected: string | null;
  onSelect: (name: string) => void;
  sources: DataSource[];
}

function CollectionRail({ collections, sources, selected, onSelect }: CollectionRailProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return collections;
    return collections.filter(
      (collection) =>
        collection.displayName.toLowerCase().includes(query) ||
        collection.name.toLowerCase().includes(query),
    );
  }, [collections, search]);

  const localCollections = filtered.filter((collection) => !collection.source);
  const sourceGroups = useMemo(() => {
    const grouped = new Map<string, MetaCollection[]>();
    for (const collection of filtered) {
      if (!collection.source) continue;
      const current = grouped.get(collection.source.sourceId) ?? [];
      current.push(collection);
      grouped.set(collection.source.sourceId, current);
    }
    return [...grouped.entries()].map(([sourceId, sourceCollections]) => ({
      sourceId,
      source: sources.find((item) => item._id === sourceId) ?? null,
      collections: sourceCollections,
    }));
  }, [filtered, sources]);

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search collections..."
          className="h-9 w-full rounded-full border border-border-soft bg-surface pl-9 pr-4 text-sm text-ink placeholder:text-ink-muted transition-[border-color,box-shadow] duration-200 focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
        />
      </div>

      <div className="flex flex-col gap-0.5">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-muted">No collections match.</p>
        ) : (
          <>
            {localCollections.length > 0 && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Bijustubu</p>
            )}
            {localCollections.map((collection, index) => {
              const isActive = collection.name === selected;
              const isExpanded = expanded.has(collection.name);
              return (
                <div key={collection._id} style={{ "--stagger": `${Math.min(index, 8) * 30}ms` } as React.CSSProperties} className="animate-fade-in">
                  <div className={cn("flex w-full items-center rounded-xl transition-colors duration-150", isActive ? "bg-sidebar text-sidebar-ink" : "text-ink hover:bg-surface-muted")}>
                    <button type="button" onClick={() => onSelect(collection.name)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", collectionDotClass(collection.name))} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{collection.displayName}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{collection.rowCount.toLocaleString()}</span>
                    </button>
                    <button type="button" onClick={() => toggleExpanded(collection.name)} title={isExpanded ? "Hide fields" : "Show fields"} className={cn("mr-1.5 shrink-0 rounded-lg p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50", isActive ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-ink-muted hover:bg-border-soft/60 hover:text-ink")}>
                      <HugeiconsIcon icon={ArrowRight01Icon} className={cn("h-3.5 w-3.5 transition-transform duration-150", isExpanded && "rotate-90")} />
                    </button>
                  </div>
                  {isExpanded && <FieldList collection={collection} />}
                </div>
              );
            })}

            {sourceGroups.map(({ sourceId, source, collections: sourceCollections }) => {
              const fallback = sourceCollections[0].source!;
              const label = source ? `${source.name} - ${source.database}:${source.port}` : fallback.sourceName;
              return (
                <details key={sourceId} className="mt-2 overflow-hidden rounded-xl border border-accent-blue/15 bg-accent-blue/[0.035]">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-left marker:content-none hover:bg-accent-blue/[0.06]">
                    <HugeiconsIcon icon={CloudServerIcon} className="h-4 w-4 shrink-0 text-accent-blue" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">{label}</span>
                      <span className="block text-[10px] text-ink-muted">{sourceCollections.length} imported collections</span>
                    </span>
                    <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  </summary>
                  <div className="border-t border-accent-blue/10 px-1.5 py-1">
                    {sourceCollections.map((collection) => {
                      const isActive = collection.name === selected;
                      return (
                        <button key={collection._id} type="button" onClick={() => onSelect(collection.name)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors", isActive ? "bg-sidebar text-sidebar-ink" : "text-ink hover:bg-surface-muted")}>
                          <HugeiconsIcon icon={CloudServerIcon} className={cn("h-3 w-3 shrink-0", isActive ? "text-sidebar-ink/70" : "text-accent-blue")} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{collection.displayName}</span>
                          <span className={cn("text-xs tabular-nums", isActive ? "text-sidebar-ink/70" : "text-ink-muted")}>{collection.rowCount.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
interface WorkspaceHeaderProps {
  collection: MetaCollection;
  onAddRow: () => void;
  addRowDisabled: boolean;
}

/** Amber callouts inside the delete-collection confirm: relations + dashboards at risk. */
function CollectionDependencyWarnings({ name, open }: { name: string; open: boolean }) {
  const depsQuery = useQuery({
    queryKey: ["collections", name, "dependencies"],
    queryFn: () => getCollectionDependencies(name),
    enabled: open,
    staleTime: 0,
  });
  const deps = depsQuery.data;
  if (!deps || (deps.relations.length === 0 && deps.dashboards.length === 0)) return null;

  return (
    <div className="flex flex-col gap-2">
      {deps.relations.length > 0 && (
        <DependencyNote
          title={`Linked by ${deps.relations.length} relation${deps.relations.length > 1 ? "s" : ""} — these will be removed`}
        >
          {deps.relations.map((relation) => (
            <p key={relation._id} className="truncate">
              {relation.type} with{" "}
              <span className="font-medium">{relation.counterpartDisplayName}</span>{" "}
              <span className="font-mono text-[10px]">
                ({relation.fromCollection}.{relation.fromField} → {relation.toCollection}.
                {relation.toField})
              </span>
            </p>
          ))}
        </DependencyNote>
      )}
      {deps.dashboards.length > 0 && (
        <DependencyNote
          title={`Used by ${deps.dashboards.length} saved dashboard${deps.dashboards.length > 1 ? "s" : ""} — their data will stop loading`}
        >
          {deps.dashboards.map((dashboard) => (
            <p key={dashboard._id} className="truncate">
              {dashboard.title}
            </p>
          ))}
        </DependencyNote>
      )}
    </div>
  );
}

function WorkspaceHeader({ collection, onAddRow, addRowDisabled }: WorkspaceHeaderProps) {
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(collection.displayName);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commitGuard = useRef(false);

  const renameMutation = useMutation({
    mutationFn: (displayName: string) => updateCollectionMeta(collection.name, { displayName }),
    onMutate: async (displayName) => {
      await queryClient.cancelQueries({ queryKey: ["collections"], exact: true });
      const previous = queryClient.getQueryData<MetaCollection[]>(["collections"]);
      queryClient.setQueryData<MetaCollection[]>(["collections"], (old) =>
        old?.map((item) =>
          item.name === collection.name ? { ...item, displayName } : item,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["collections"], context.previous);
      setError("Could not rename the collection.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCollection(collection.name),
    onSuccess: () => {
      setDeleteOpen(false);
      queryClient.removeQueries({ queryKey: ["collections", collection.name] });
      void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
    },
    onError: () => setError("Could not delete the collection."),
  });

  function startEditing() {
    setError(null);
    setNameDraft(collection.displayName);
    commitGuard.current = false;
    setEditingName(true);
  }

  function commitName() {
    if (commitGuard.current) return;
    commitGuard.current = true;
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== collection.displayName) {
      setError(null);
      renameMutation.mutate(trimmed);
    }
  }

  function cancelName() {
    commitGuard.current = true;
    setEditingName(false);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue">
          <HugeiconsIcon icon={Database01Icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") cancelName();
              }}
              onBlur={commitName}
              className="w-full max-w-md rounded-lg border border-accent-blue/50 bg-surface px-2 py-0.5 text-lg font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-blue/40"
            />
          ) : (
            <button
              type="button"
              onClick={startEditing}
              title="Rename collection"
              className="group flex min-w-0 max-w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50"
            >
              <span className="truncate text-lg font-semibold leading-tight text-ink">
                {collection.displayName}
              </span>
              <HugeiconsIcon icon={PencilEdit02Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          )}
          <p className="truncate text-xs text-ink-muted">
            {collection.name} · {collection.rowCount.toLocaleString()} rows ·{" "}
            {collection.fields.length.toLocaleString()} fields
          </p>
          {error && <p className="mt-0.5 animate-fade-in text-xs text-rose-600">{error}</p>}
          {collection.source && (
            <p className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-blue/10 px-2 py-0.5 text-[11px] font-medium text-accent-blue" title={`Synced from ${collection.source.sourceName}, table ${collection.source.table}`}>
              <HugeiconsIcon icon={CloudServerIcon} className="h-3 w-3 shrink-0" />
              <span className="truncate">Live source from {collection.source.sourceName} / {collection.source.table}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={onAddRow} disabled={addRowDisabled}>
          <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" /> Add row
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              title="Collection actions"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-rose-600 focus:bg-rose-50 focus:text-rose-600"
              onSelect={() => setDeleteOpen(true)}
            >
              <HugeiconsIcon icon={Delete02Icon} className="mr-2 h-3.5 w-3.5" /> Delete collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete collection</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-medium text-ink">{collection.displayName}</span> (
              {collection.rowCount.toLocaleString()} rows) along with its schema and any relations
              that reference it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <CollectionDependencyWarnings name={collection.name} open={deleteOpen} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Delete {collection.displayName}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CollectionWorkspaceProps {
  collection: MetaCollection;
}

/** Toolbar header + grid for one collection (fields are edited from the sidebar rail). */
function CollectionWorkspace({ collection }: CollectionWorkspaceProps) {
  const [draftOpen, setDraftOpen] = useState(false);

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      <WorkspaceHeader
        collection={collection}
        onAddRow={() => setDraftOpen(true)}
        addRowDisabled={draftOpen}
      />
      <DataGrid
        collectionName={collection.name}
        draftOpen={draftOpen}
        onDraftOpenChange={setDraftOpen}
      />
    </div>
  );
}

function CollectionsTab() {
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: getCollections });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: getSources });
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);

  const collections = collectionsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const paramName = searchParams.get("c");

  useEffect(() => {
    if (!collectionsQuery.data) return;
    // URL param wins when it names a real collection (supports /collections?c=<name> links).
    if (paramName && collectionsQuery.data.some((item) => item.name === paramName)) {
      if (selected !== paramName) setSelected(paramName);
      return;
    }
    if (selected && collectionsQuery.data.some((item) => item.name === selected)) return;
    setSelected(collectionsQuery.data[0]?.name ?? null);
  }, [collectionsQuery.data, paramName, selected]);

  const handleSelect = useCallback(
    (name: string) => {
      setSelected(name);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("c", name);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const active = collections.find((item) => item.name === selected) ?? null;

  if (collectionsQuery.isLoading) {
    return (
      <Card className="animate-fade-in">
        <CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex animate-pulse items-center gap-4">
              <div className="h-9 w-9 rounded-xl bg-surface-muted" />
              <div className="h-3 flex-1 rounded-full bg-surface-muted" />
              <div className="h-3 w-16 rounded-full bg-surface-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (collections.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-1 py-8">
            <Lottie src={emptyAstronaut} className="h-40 w-40" />
            <p className="text-sm text-ink-muted">
              No collections yet —{" "}
              <Link to="/documents" className="font-medium text-accent-blue hover:underline">
                upload a document
              </Link>{" "}
              to get started.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-in-up overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-border-soft bg-surface-muted/30 p-4 lg:w-[264px] lg:border-b-0 lg:border-r">
          <CollectionRail collections={collections} sources={sources} selected={selected} onSelect={handleSelect} />
        </aside>

        <div className="min-w-0 flex-1 p-5">
          {active ? (
            <CollectionWorkspace key={active.name} collection={active} />
          ) : (
            <p className="py-16 text-center text-sm text-ink-muted">
              Select a collection to browse its data.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function CollectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "relations" ? "relations" : "collections";
  return (
    <div>
      <TopBar title="Collections" />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "collections") next.delete("tab");
          else next.set("tab", value);
          setSearchParams(next, { replace: true });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="relations">Relations</TabsTrigger>
          </TabsList>
          <CustomTableDialog />
        </div>

        <TabsContent value="collections" className="mt-5">
          <CollectionsTab />
          <SavedCustomTables />
        </TabsContent>
        <TabsContent value="relations" className="mt-5">
          <RelationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
