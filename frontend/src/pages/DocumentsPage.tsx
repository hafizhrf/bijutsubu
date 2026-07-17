import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourcesPanel } from "@/components/sources/SourcesPanel";
import { useDropzone } from "react-dropzone";
import { useQuery } from "@tanstack/react-query";
import { getCollections } from "@/api/collections";
import { getActivity } from "@/api/activity";
import { cn } from "@/lib/utils";
import { useUploadQueueStore } from "@/store/uploadQueueStore";
import type { QueueItem } from "@/store/uploadQueueStore";
import type { ApplyDecision } from "@/types/collections";
import { UploadDecisionPanel } from "@/components/documents/UploadDecisionPanel";
import { Lottie } from "@/components/ui/lottie";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import emptyAstronaut from "@/assets/lottie/empty-astronaut.lottie";
import { TopBar } from "@/components/layout/TopBar";
import { CollectionList } from "@/components/collections/CollectionList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CollectionMentionInput } from "@/components/prompt/CollectionMentionInput";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowRight02Icon,
  Cancel01Icon,
  Clock01Icon,
  CloudUploadIcon,
  File02Icon,
  FileUploadIcon,
  Forward02Icon,
  InformationCircleIcon,
  Loading03Icon,
  MouseLeftClick01Icon,
  SourceCodeIcon,
  Tick02Icon,
  Xls01Icon,
} from "@hugeicons/core-free-icons";

const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/sql": [".sql"],
};

const FORMAT_CHIPS = ["PDF", "CSV", "XLSX", "DOCX", "TXT", "MD", "SQL"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ fileName, className }: { fileName: string; className?: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "xls" || ext === "xlsx") {
    return <HugeiconsIcon icon={Xls01Icon} className={className} />;
  }
  if (ext === "md" || ext === "sql") {
    return <HugeiconsIcon icon={SourceCodeIcon} className={className} />;
  }
  return <HugeiconsIcon icon={File02Icon} className={className} />;
}

function StatusChip({ item, now }: { item: QueueItem; now: number }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold";
  switch (item.status) {
    case "queued":
      return <span className={cn(base, "bg-surface-muted text-ink-muted")}>Queued</span>;
    case "uploading":
      return (
        <span className={cn(base, "bg-accent-blue/10 text-accent-blue")}>
          <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" /> Uploading
        </span>
      );
    case "waiting": {
      const seconds =
        item.retryAt !== null ? Math.max(0, Math.ceil((item.retryAt - now) / 1000)) : 0;
      return (
        <span className={cn(base, "bg-amber-100 text-amber-800")}>
          <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" /> Retrying in {seconds}s
        </span>
      );
    }
    case "needs-decision":
      return (
        <span className={cn(base, "bg-amber-100 text-amber-800")}>
          <HugeiconsIcon icon={MouseLeftClick01Icon} className="h-3 w-3" /> Needs your decision
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "bg-emerald-100 text-emerald-700")}>
          <HugeiconsIcon icon={Tick02Icon} className="h-3 w-3" /> Done
        </span>
      );
    case "error":
      return (
        <span className={cn(base, "bg-rose-100 text-rose-700")}>
          <HugeiconsIcon icon={AlertCircleIcon} className="h-3 w-3" /> Failed
        </span>
      );
    case "canceled":
      return (
        <span className={cn(base, "bg-surface-muted text-ink-muted")}>
          <HugeiconsIcon icon={Forward02Icon} className="h-3 w-3" /> Skipped
        </span>
      );
  }
}

function writeStatsLine(collection: {
  insertedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  rowsMissingKey: number;
}): string | null {
  const parts: string[] = [];
  if (collection.insertedCount > 0) parts.push(`${collection.insertedCount} added`);
  if (collection.updatedCount > 0) parts.push(`${collection.updatedCount} updated`);
  if (collection.skippedDuplicateCount > 0) {
    parts.push(`${collection.skippedDuplicateCount} duplicates skipped`);
  }
  if (collection.rowsMissingKey > 0) {
    parts.push(`${collection.rowsMissingKey} without a unique key`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function QueueRow({
  item,
  now,
  index,
  onRemove,
  onResolve,
  onSkip,
}: {
  item: QueueItem;
  now: number;
  index: number;
  onRemove: (id: string) => void;
  onResolve: (id: string, decision: ApplyDecision) => void;
  onSkip: (id: string) => void;
}) {
  return (
    <li
      className="animate-fade-in-up rounded-2xl border border-border-soft bg-surface p-4"
      style={{ "--stagger": `${Math.min(index, 8) * 50}ms` } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
          <FileTypeIcon fileName={item.fileName} className="h-4.5 w-4.5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.fileName}</p>
          <p className="text-xs text-ink-muted">{formatBytes(item.fileSize)}</p>
        </div>

        <StatusChip item={item} now={now} />

        {item.status !== "uploading" && (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.fileName} from queue`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {item.status === "uploading" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-hero-from to-hero-to animate-shimmer" />
        </div>
      )}

      {item.status === "error" && item.errorMessage && (
        <p className="mt-2 animate-fade-in text-sm text-rose-600">{item.errorMessage}</p>
      )}

      {item.status === "needs-decision" && item.pending && (
        <UploadDecisionPanel
          fileName={item.fileName}
          pending={item.pending}
          errorMessage={item.errorMessage}
          now={now}
          onResolve={(decision) => onResolve(item.id, decision)}
          onSkip={() => onSkip(item.id)}
        />
      )}

      {item.status === "done" && item.result && (
        <div className="mt-3 flex animate-fade-in-up flex-col gap-3 rounded-2xl bg-surface-muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <HugeiconsIcon icon={ArrowRight02Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
              <span className="truncate font-semibold text-ink">
                {item.result.collection.displayName}
              </span>
              <span className="shrink-0 text-ink-muted">
                {item.result.collection.rowCount.toLocaleString()} rows
              </span>
            </div>
            <Badge variant="blue" className="capitalize">
              {item.result.plan.action}
            </Badge>
          </div>

          {writeStatsLine(item.result.collection) && (
            <p className="text-xs text-ink-muted">{writeStatsLine(item.result.collection)}</p>
          )}

          {item.result.similarityNote && (
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <HugeiconsIcon icon={InformationCircleIcon} className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-medium">Heads up — similar data detected</p>
                <p>{item.result.similarityNote}</p>
                {item.result.similarCollections.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {item.result.similarCollections.map((similar) => (
                      <li key={similar.name}>
                        <Badge variant="outline" className="border-amber-300 text-amber-900">
                          {similar.displayName}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function DocumentsPage() {
  const [instruction, setInstruction] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const items = useUploadQueueStore((state) => state.items);
  const enqueue = useUploadQueueStore((state) => state.enqueue);
  const remove = useUploadQueueStore((state) => state.remove);
  const clearFinished = useUploadQueueStore((state) => state.clearFinished);
  const resolveDecision = useUploadQueueStore((state) => state.resolveDecision);
  const skipDecision = useUploadQueueStore((state) => state.skipDecision);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    accept: ACCEPTED_TYPES,
    onDrop: (accepted) => {
      if (accepted.length === 0) return;
      // Stage only — nothing uploads until the user hits the Upload button,
      // so the instruction can still be filled in (or fixed) first.
      setStaged((prev) => {
        const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
        return [...prev, ...accepted.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`))];
      });
    },
  });

  function removeStaged(index: number) {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUploadClick() {
    if (staged.length === 0) return;
    enqueue(staged, instruction);
    setStaged([]);
  }

  const hasTicking = items.some(
    (item) => item.status === "waiting" || item.status === "needs-decision",
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasTicking) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasTicking]);

  const doneCount = items.filter((item) => item.status === "done").length;
  const activeCount = items.filter((item) => ["queued", "uploading", "waiting", "needs-decision"].includes(item.status)).length;
  const hasFinished = items.some(
    (item) => item.status === "done" || item.status === "error" || item.status === "canceled",
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "sources" ? "sources" : "uploads";

  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: getCollections });
  const uploadHistoryQuery = useQuery({
    queryKey: ["activity", "document", 8],
    queryFn: () => getActivity({ prefix: "document", limit: 8 }),
  });
  const historyEntries = uploadHistoryQuery.data?.entries ?? [];

  return (
    <div>
      <TopBar title="Documents" />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "uploads") next.delete("tab");
          else next.set("tab", value);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList className="mb-5 max-w-full overflow-x-auto">
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="mt-0">
          <SourcesPanel />
        </TabsContent>

        <TabsContent value="uploads" className="mt-0">
      <Card>
        <CardContent className="p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <div
              {...getRootProps()}
              aria-label="Select files to stage for upload"
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-border-soft bg-surface-muted px-6 py-8 text-center transition-all duration-200 ease-in-out hover:border-ink-muted/40",
                isDragActive &&
                  "scale-[1.01] border-accent-blue bg-accent-blue/5 shadow-[0_0_0_6px_rgba(91,124,250,0.14)]",
              )}
            >
              <input {...getInputProps()} />
              {/* Fanned document sheets built from theme tokens (no brand
                  gradient) — the back sheet spreads apart while dragging. */}
              <div
                className={cn(
                  "relative h-14 w-14 transition-transform duration-200 ease-in-out",
                  isDragActive && "scale-110",
                )}
              >
                <div
                  className={cn(
                    "absolute inset-x-2 inset-y-1 -rotate-6 rounded-lg border border-border-soft bg-surface-muted transition-transform duration-200",
                    isDragActive && "-rotate-12",
                  )}
                />
                <div className="absolute inset-x-2 inset-y-1 flex rotate-3 items-center justify-center rounded-lg border border-border-soft bg-surface shadow-sm">
                  <HugeiconsIcon icon={FileUploadIcon} className="h-5 w-5 text-ink-muted" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold tracking-tight text-ink">
                  {isDragActive ? "Release to add files" : "Drop files here"}
                </p>
                <p className="text-sm text-ink-muted">
                  Files wait below until you hit Upload — nothing is sent yet.
                </p>
              </div>
              <ul className="flex flex-wrap items-center justify-center gap-1.5">
                {FORMAT_CHIPS.map((format) => (
                  <li
                    key={format}
                    className="rounded-full border border-border-soft bg-surface px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-ink-muted"
                  >
                    {format}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="instruction">Instruction (optional)</Label>
              <CollectionMentionInput
                id="instruction"
                multiline
                value={instruction}
                onValueChange={setInstruction}
                placeholder={'e.g. "Append this file into {sales_2026}" — type "{" to reference a collection'}
                className="h-full min-h-24 bg-surface-muted focus-visible:bg-surface"
                containerClassName="flex-1"
              />
              <p className="text-xs text-ink-muted">
                Applies to the staged files below. Leave blank to always create new collections.
              </p>

              {staged.length > 0 ? (
                <ul
                  className={cn(
                    "mt-1 flex max-h-40 flex-col gap-1.5 overflow-y-auto",
                    THIN_SCROLLBAR_CLASS,
                  )}
                >
                  {staged.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex animate-fade-in items-center gap-2.5 rounded-xl border border-border-soft bg-surface px-3 py-2"
                    >
                      <FileTypeIcon
                        fileName={file.name}
                        className="h-4 w-4 shrink-0 text-ink-muted"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {formatBytes(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStaged(index)}
                        aria-label={`Remove ${file.name}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 rounded-xl border border-dashed border-border-soft bg-surface-muted/40 px-4 py-3 text-center text-xs text-ink-muted">
                  Files you drop on the left are listed here before anything uploads.
                </div>
              )}

              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-soft pt-3">
                <p className="text-xs tabular-nums text-ink-muted">
                  {staged.length > 0
                    ? `${staged.length} file${staged.length > 1 ? "s" : ""} staged · ${formatBytes(
                        staged.reduce((sum, file) => sum + file.size, 0),
                      )}`
                    : "No files staged yet"}
                </p>
                <Button onClick={handleUploadClick} disabled={staged.length === 0}>
                  <HugeiconsIcon icon={CloudUploadIcon} className="h-4 w-4" />
                  {staged.length > 0
                    ? `Upload ${staged.length} file${staged.length > 1 ? "s" : ""}`
                    : "Upload"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card className="mt-8 animate-fade-in-up">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Upload queue</CardTitle>
              <CardDescription>
                {activeCount > 0 ? `${activeCount} active ${activeCount === 1 ? "upload" : "uploads"}` : "No active uploads"}{doneCount > 0 ? ` · ${doneCount} uploaded` : ""} · one file per minute, handled for you
              </CardDescription>
            </div>
            {hasFinished && (
              <Button variant="ghost" size="sm" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-3">
              {[...items].sort((a, b) => b.addedAt - a.addedAt).map((item, index) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  now={now}
                  index={index}
                  onRemove={remove}
                  onResolve={resolveDecision}
                  onSkip={skipDecision}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {historyEntries.length > 0 && (
        <Card className="mt-8 animate-fade-in-up">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Upload history</CardTitle>
              <CardDescription>
                Recent document activity — the full trail lives in the Log page.
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/logs">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="flex flex-col divide-y divide-border-soft">
              {historyEntries.map((entry) => (
                <li key={entry._id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <HugeiconsIcon icon={FileUploadIcon} className="h-3.5 w-3.5" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-ink" title={entry.summary}>
                    {entry.summary}
                  </p>
                  <time
                    dateTime={entry.createdAt}
                    className="shrink-0 text-xs tabular-nums text-ink-muted"
                  >
                    {new Date(entry.createdAt).toLocaleString("en", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Your collections</CardTitle>
          <CardDescription>Every dataset that's been ingested so far.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CollectionList
            collections={collectionsQuery.data ?? []}
            isLoading={collectionsQuery.isLoading}
            emptyState={
              <div className="flex flex-col items-center gap-1 py-8">
                <Lottie src={emptyAstronaut} className="h-40 w-40" />
                <p className="text-sm text-ink-muted">
                  No collections yet — upload a document above to get started.
                </p>
              </div>
            }
          />
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
