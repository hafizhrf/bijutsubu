import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type { Connection, EdgeTypes, NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getCollections, getRelations, promptRelations } from "@/api/collections";
import { getSources } from "@/api/sources";
import { useIsDark } from "@/lib/useIsDark";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CollectionMentionInput } from "@/components/prompt/CollectionMentionInput";
import type { MetaRelation, RelationPromptResponse } from "@/types/collections";
import { CollectionNode } from "./CollectionNode";
import { RelationDialog } from "./RelationDialog";
import type { RelationDialogState } from "./RelationDialog";
import { RelationEdge } from "./RelationEdge";
import type { CollectionFlowNode, RelationFlowEdge } from "./types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  FolderUploadIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

const POSITIONS_STORAGE_KEY = "bijustubu-canvas-positions";

const nodeTypes: NodeTypes = { collection: CollectionNode };
const edgeTypes: EdgeTypes = { relation: RelationEdge };

type StoredPositions = Record<string, { x: number; y: number }>;

function loadStoredPositions(): StoredPositions {
  try {
    const raw = localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const positions: StoredPositions = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { x?: unknown }).x === "number" &&
        typeof (value as { y?: unknown }).y === "number"
      ) {
        positions[key] = { x: (value as { x: number }).x, y: (value as { y: number }).y };
      }
    }
    return positions;
  } catch {
    return {};
  }
}

function storePositions(updates: StoredPositions): void {
  try {
    const merged = { ...loadStoredPositions(), ...updates };
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable — canvas still works, positions just won't persist.
  }
}

function defaultPosition(index: number, total: number): { x: number; y: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 60 + column * 340,
    y: 40 + row * 380 + (column % 2) * 48,
  };
}

/** Scoped restyling of React Flow chrome to match the app theme — colors come
 *  from the token vars, so dark mode and accent themes apply automatically. */
const canvasStyles = `
.relations-canvas .react-flow__handle.relations-field-handle {
  width: 11px;
  height: 11px;
  border-radius: 9999px;
  background: var(--color-surface);
  border: 2px solid var(--color-border-soft);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.relations-canvas .react-flow__handle.relations-field-handle:hover,
.relations-canvas .react-flow__handle.relations-field-handle.connectingfrom,
.relations-canvas .react-flow__handle.relations-field-handle.connectingto,
.relations-canvas .react-flow__handle.relations-field-handle.valid {
  border-color: var(--color-accent-blue);
  background: var(--color-accent-blue);
}
.relations-canvas .react-flow__handle-left.relations-field-handle {
  left: -5.5px;
  top: 50%;
  transform: translateY(-50%);
}
.relations-canvas .react-flow__handle-right.relations-field-handle {
  right: -5.5px;
  top: 50%;
  transform: translateY(-50%);
}
.relations-canvas .react-flow__edge { cursor: pointer; }
.relations-canvas .react-flow__edge:hover .react-flow__edge-path { stroke: var(--color-accent-blue); opacity: 1; }
.relations-canvas .react-flow__controls {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  box-shadow: var(--shadow-card);
}
.relations-canvas .react-flow__controls-button {
  background: var(--color-surface);
  border: none;
  border-bottom: 1px solid var(--color-border-soft);
  width: 30px;
  height: 30px;
  color: var(--color-ink);
}
.relations-canvas .react-flow__controls-button:last-child { border-bottom: none; }
.relations-canvas .react-flow__controls-button:hover { background: var(--color-surface-muted); }
.relations-canvas .react-flow__controls-button svg { fill: currentColor; }
.relations-canvas .react-flow__minimap {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  background: var(--color-surface-muted);
  box-shadow: var(--shadow-card);
}
.relations-canvas .react-flow__attribution {
  background: transparent;
  color: var(--color-ink-muted);
}
`;

function computeConnectedFields(relations: MetaRelation[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  const add = (collection: string, field: string) => {
    const existing = map.get(collection) ?? new Set<string>();
    existing.add(field);
    map.set(collection, existing);
  };
  for (const relation of relations) {
    add(relation.fromCollection, relation.fromField);
    add(relation.toCollection, relation.toField);
  }
  return new Map(Array.from(map.entries(), ([name, fields]) => [name, Array.from(fields).sort()]));
}

function PromptBar({
  relations,
  collectionLabels,
  onSelectRelation,
}: {
  relations: MetaRelation[];
  collectionLabels: Record<string, string>;
  onSelectRelation: (relation: MetaRelation) => void;
}) {
  const relationCount = relations.length;
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [summary, setSummary] = useState<string | null>(null);

  const promptMutation = useMutation<RelationPromptResponse, unknown, string>({
    mutationFn: promptRelations,
    onSuccess: (response) => {
      setSummary(response.changes.summary);
      setPrompt("");
      void queryClient.invalidateQueries({ queryKey: ["relations"] });
      // The prompt may have created a foreign-key field (add-field op) — the
      // collection nodes need the fresh field list to show it.
      void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
    },
  });

  useEffect(() => {
    if (!summary) return;
    const timer = setTimeout(() => setSummary(null), 8000);
    return () => clearTimeout(timer);
  }, [summary]);

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = prompt.trim();
          if (trimmed && !promptMutation.isPending) promptMutation.mutate(trimmed);
        }}
      >
        <div className="relative flex-1">
          <HugeiconsIcon icon={SparklesIcon} className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-accent-blue" />
          <CollectionMentionInput
            value={prompt}
            onValueChange={setPrompt}
            placeholder={'Describe relations in plain language, e.g. "{orders}.customer_id links to {customers}.id" — type "{" for suggestions'}
            className="pl-11"
            disabled={promptMutation.isPending}
          />
        </div>
        <Button type="submit" disabled={!prompt.trim() || promptMutation.isPending}>
          {promptMutation.isPending ? "Applying…" : "Apply"}
        </Button>
        {relationCount === 0 ? (
          <Badge variant="muted" className="hidden shrink-0 sm:inline-flex">
            0 relations
          </Badge>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden shrink-0 items-center rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-border-soft hover:text-ink sm:inline-flex"
              >
                {relationCount} relation{relationCount === 1 ? "" : "s"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-80">
              {relations.map((relation) => (
                <DropdownMenuItem
                  key={relation._id}
                  onSelect={() => onSelectRelation(relation)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="text-xs font-medium text-ink">
                    {collectionLabels[relation.fromCollection] ?? relation.fromCollection} →{" "}
                    {collectionLabels[relation.toCollection] ?? relation.toCollection}
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted">
                    {relation.fromField} → {relation.toField} · {relation.type}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </form>
      {summary && (
        <div className="animate-fade-in-up flex items-start gap-2 rounded-2xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{summary}</span>
        </div>
      )}
      {promptMutation.isError && (
        <div className="animate-fade-in rounded-2xl bg-rose-50 px-4 py-2.5 text-xs text-rose-600">
          Could not apply that prompt. Please try rephrasing it.
        </div>
      )}
    </div>
  );
}

function RelationsCanvas() {
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: getCollections });
  const relationsQuery = useQuery({ queryKey: ["relations"], queryFn: getRelations });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: getSources });
  // React Flow paints Background/MiniMap colors as SVG attributes, so CSS
  // vars can't be used there — pick concrete colors per mode instead.
  const isDark = useIsDark();

  const [nodes, setNodes, onNodesChange] = useNodesState<CollectionFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationFlowEdge>([]);
  const [dialogState, setDialogState] = useState<RelationDialogState | null>(null);

  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const didFitRef = useRef(false);

  const collections = collectionsQuery.data;
  const relations = relationsQuery.data;
  const [scope, setScope] = useState<string>("local");
  const sources = sourcesQuery.data ?? [];
  const visibleCollections = useMemo(() => {
    if (scope === "local") return collections?.filter((collection) => !collection.source);
    return collections?.filter((collection) => collection.source?.sourceId === scope);
  }, [collections, scope]);
  const visibleRelations = useMemo(() => {
    if (!relations || !visibleCollections) return [];
    const names = new Set(visibleCollections.map((collection) => collection.name));
    return relations.filter((relation) => names.has(relation.fromCollection) && names.has(relation.toCollection));
  }, [relations, visibleCollections]);

  // Sync nodes from the collections query, preserving current/stored positions.
  useEffect(() => {
    if (!visibleCollections) return;
    const stored = loadStoredPositions();
    const connectedFields = computeConnectedFields(visibleRelations);
    setNodes((previous) => {
      const previousPositions = new Map(previous.map((node) => [node.id, node.position]));
      return visibleCollections.map((collection, index) => ({
        id: collection.name,
        type: "collection" as const,
        position:
          previousPositions.get(collection.name) ??
          stored[collection.name] ??
          defaultPosition(index, visibleCollections.length),
        data: {
          collection,
          connectedFields: connectedFields.get(collection.name) ?? [],
        },
      }));
    });
  }, [visibleCollections, visibleRelations, setNodes]);

  // Sync edges from the relations query; skip relations pointing at unknown
  // collections/fields so React Flow never gets a dangling edge.
  useEffect(() => {
    if (!visibleCollections) return;
    setEdges(
      visibleRelations.map((relation) => ({
          id: relation._id,
          source: relation.fromCollection,
          target: relation.toCollection,
          sourceHandle: relation.fromField,
          targetHandle: relation.toField,
          type: "relation" as const,
          animated: true,
          data: { relation },
        })),
    );
  }, [visibleCollections, visibleRelations, setEdges]);

  // Fit the view once nodes have been measured on first load.
  useEffect(() => {
    if (didFitRef.current || !nodesInitialized || nodes.length === 0) return;
    didFitRef.current = true;
    void fitView({ padding: 0.25, maxZoom: 1 });
  }, [nodesInitialized, nodes.length, fitView]);

  const onConnect = useCallback((connection: Connection) => {
    if (
      !connection.source ||
      !connection.target ||
      !connection.sourceHandle ||
      !connection.targetHandle
    ) {
      return;
    }
    setDialogState({
      mode: "create",
      draft: {
        fromCollection: connection.source,
        toCollection: connection.target,
        fromField: connection.sourceHandle,
        toField: connection.targetHandle,
      },
    });
  }, []);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: RelationFlowEdge) => {
    const relation = edge.data?.relation;
    if (relation) setDialogState({ mode: "edit", relation });
  }, []);

  const onNodeDragStop = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      _node: CollectionFlowNode,
      draggedNodes: CollectionFlowNode[],
    ) => {
      const updates: StoredPositions = {};
      for (const dragged of draggedNodes) {
        updates[dragged.id] = { x: dragged.position.x, y: dragged.position.y };
      }
      storePositions(updates);
    },
    [],
  );

  const collectionLabels = useMemo(
    () =>
      Object.fromEntries(
        (visibleCollections ?? []).map((collection) => [collection.name, collection.displayName]),
      ),
    [visibleCollections],
  );

  const isLoading = collectionsQuery.isPending || relationsQuery.isPending;
  const isError = collectionsQuery.isError || relationsQuery.isError;

  if (isLoading) {
    return (
      <div className="relative h-[calc(100vh-260px)] min-h-[500px] overflow-hidden rounded-card border border-border-soft bg-surface-muted">
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          Loading relations canvas…
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-[calc(100vh-260px)] min-h-[500px] flex-col items-center justify-center gap-4 rounded-card border border-border-soft bg-surface">
        <p className="text-sm text-ink-muted">Could not load collections or relations.</p>
        <Button
          variant="outline"
          onClick={() => {
            void collectionsQuery.refetch();
            void relationsQuery.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!collections || collections.length === 0) {
    return (
      <div className="flex h-[calc(100vh-260px)] min-h-[500px] flex-col items-center justify-center gap-4 rounded-card border border-border-soft bg-surface px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-blue/10 text-accent-blue">
          <HugeiconsIcon icon={FolderUploadIcon} className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">No collections yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            Upload a document to create your first collection, then come back here to map how your
            data relates.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/documents">Go to Documents</Link>
        </Button>
      </div>
    );
  }

  const showHint = visibleRelations.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border-soft bg-surface-muted/50 p-1">
        <button type="button" onClick={() => setScope("local")} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors", scope === "local" ? "bg-sidebar text-sidebar-ink" : "text-ink-muted hover:text-ink")}>Bijustubu</button>
        {sources.map((source) => (
          <button key={source._id} type="button" onClick={() => setScope(source._id)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors", scope === source._id ? "bg-sidebar text-sidebar-ink" : "text-ink-muted hover:text-ink")}>
            {source.name} - {source.database}:{source.port}
          </button>
        ))}
      </div>
      <PromptBar
        relations={visibleRelations}
        collectionLabels={collectionLabels}
        onSelectRelation={(relation) => setDialogState({ mode: "edit", relation })}
      />

      <div className="relations-canvas relative h-[calc(100vh-260px)] min-h-[500px] overflow-hidden rounded-card border border-border-soft bg-canvas shadow-card">
        <style>{canvasStyles}</style>
        {showHint && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4">
            <div className="animate-fade-in-up rounded-full border border-border-soft bg-surface/90 px-4 py-2 text-xs text-ink-muted shadow-card backdrop-blur">
              Drag from a field&apos;s right handle to a field on another collection to create a
              relation
            </div>
          </div>
        )}
        <ReactFlow<CollectionFlowNode, RelationFlowEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.2}
          maxZoom={1.75}
          deleteKeyCode={null}
          connectionRadius={24}
          connectionLineStyle={{ stroke: "var(--color-accent-blue)", strokeWidth: 2 }}
          defaultEdgeOptions={{ type: "relation" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={2}
            color={isDark ? "#33333e" : "#d8d4c8"}
          />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={() => (isDark ? "#2d2d36" : "#e7e5df")}
            nodeStrokeColor={() => (isDark ? "#3a3a45" : "#d1cec5")}
            nodeBorderRadius={8}
            maskColor={isDark ? "rgba(16, 16, 20, 0.7)" : "rgba(241, 239, 233, 0.7)"}
          />
        </ReactFlow>
      </div>

      <RelationDialog
        state={dialogState}
        onClose={() => setDialogState(null)}
        collectionLabels={collectionLabels}
      />
    </div>
  );
}

export function RelationsTab() {
  return (
    <ReactFlowProvider>
      <RelationsCanvas />
    </ReactFlowProvider>
  );
}
