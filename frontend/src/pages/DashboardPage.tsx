import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromptDock } from "@/components/genui/PromptDock";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useGenerationQueueStore } from "@/store/generationQueueStore";
import type { GenerationItem } from "@/store/generationQueueStore";
import type { SavedDashboardSummary } from "@/types/dashboard";
import { formatIsoDate } from "@/components/ui/data-cell";
import { Lottie } from "@/components/ui/lottie";
import genuiLoading from "@/assets/lottie/genui-loading.lottie";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  InformationCircleIcon,
  Loading03Icon,
  PencilEdit02Icon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

const EXAMPLE_PROMPTS = [
  "Build a full report: a headline, summary stats, a chart per category, and the data table",
  "Show revenue over time as an area chart with key numbers up top",
  "Rank my top categories as a list with progress bars",
];

function QueueStatusChip({ item, now }: { item: GenerationItem; now: number }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold";
  switch (item.status) {
    case "queued":
      return <span className={cn(base, "bg-surface-muted text-ink-muted")}>Queued</span>;
    case "generating":
      return (
        <span className={cn(base, "bg-accent-blue/10 text-accent-blue")}>
          <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" /> Generating
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
    case "rejected":
      return (
        <span className={cn(base, "bg-surface-muted text-ink-muted")}>
          <HugeiconsIcon icon={InformationCircleIcon} className="h-3 w-3" /> Rejected
        </span>
      );
    case "error":
      return (
        <span className={cn(base, "bg-rose-100 text-rose-700")}>
          <HugeiconsIcon icon={AlertCircleIcon} className="h-3 w-3" /> Failed
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "bg-emerald-100 text-emerald-700")}>
          <HugeiconsIcon icon={Tick02Icon} className="h-3 w-3" /> Done
        </span>
      );
  }
}

const GENERATION_STEPS: { stage: NonNullable<GenerationItem["stage"]>; label: string }[] = [
  { stage: "guarding", label: "Understanding request" },
  { stage: "designing", label: "Designing dashboard" },
  { stage: "executing", label: "Running queries" },
  { stage: "saving", label: "Saving" },
];

/** Step checklist for an in-flight generation; falls back to nothing when the
 *  stage is unknown (progress poll 404s — the spinner chip still shows). */
function GenerationSteps({ stage }: { stage: GenerationItem["stage"] }) {
  if (!stage) return null;
  const activeIndex = GENERATION_STEPS.findIndex((step) => step.stage === stage);
  return (
    <ol className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Generation progress">
      {GENERATION_STEPS.map((step, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
        return (
          <li key={step.stage} className="flex items-center gap-1.5 text-[11px] font-medium">
            {state === "done" ? (
              <HugeiconsIcon icon={Tick02Icon} className="h-3 w-3 text-emerald-600" />
            ) : state === "active" ? (
              <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin text-accent-blue" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-border-soft" aria-hidden="true" />
            )}
            <span
              className={cn(
                state === "done" && "text-ink-muted",
                state === "active" && "text-ink",
                state === "todo" && "text-ink-muted/60",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function QueueRow({
  item,
  now,
  onRemove,
}: {
  item: GenerationItem;
  now: number;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex animate-fade-in items-center gap-3 rounded-2xl border border-border-soft bg-surface p-4">
      {item.status === "generating" ? (
        <Lottie src={genuiLoading} className="h-10 w-10 shrink-0" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-hero-from to-hero-to text-white">
          <HugeiconsIcon icon={SparklesIcon} className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.title}</p>
        {(item.status === "rejected" || item.status === "error") && item.reason ? (
          <p className="text-xs text-rose-600">{item.reason}</p>
        ) : (
          <p className="truncate text-xs text-ink-muted">{item.prompt}</p>
        )}
        {item.status === "generating" && <GenerationSteps stage={item.stage} />}
      </div>
      <QueueStatusChip item={item} now={now} />
      {item.status !== "generating" && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.title} from queue`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function SavedRow({ dashboard }: { dashboard: SavedDashboardSummary }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [titleInput, setTitleInput] = useState(dashboard.title);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const renameMutation = useMutation({
    mutationFn: async (title: string) => {
      await api.patch(`/dashboard/saved/${dashboard._id}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboards", "saved"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/dashboard/saved/${dashboard._id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboards", "saved"] });
    },
  });

  function submitRename() {
    const title = titleInput.trim();
    if (!title || title === dashboard.title) {
      setEditing(false);
      setTitleInput(dashboard.title);
      return;
    }
    renameMutation.mutate(title);
  }

  return (
    <li className="group flex animate-fade-in items-center gap-3 rounded-2xl border border-border-soft bg-surface p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-hero-from to-hero-to text-white">
        <HugeiconsIcon icon={SparklesIcon} className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
                if (event.key === "Escape") {
                  setEditing(false);
                  setTitleInput(dashboard.title);
                }
              }}
              className="h-8"
            />
            <Button size="sm" onClick={submitRename} disabled={renameMutation.isPending}>
              {renameMutation.isPending ? (
                <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HugeiconsIcon icon={Tick02Icon} className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate(`/dashboard/${dashboard._id}`)}
            className="block w-full min-w-0 text-left"
          >
            <p className="truncate text-sm font-medium text-ink">{dashboard.title}</p>
            <p className="truncate text-xs text-ink-muted">{dashboard.prompt}</p>
          </button>
        )}
      </div>

      <span
        className="hidden shrink-0 text-xs tabular-nums text-ink-muted sm:block"
        title={dashboard.createdAt}
      >
        {formatIsoDate(dashboard.createdAt)}
      </span>

      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Rename"
            onClick={() => {
              setTitleInput(dashboard.title);
              setEditing(true);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition-[opacity,color,background-color] hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <HugeiconsIcon icon={PencilEdit02Icon} className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Delete dashboard"
            onClick={() => setConfirmOpen(true)}
            disabled={deleteMutation.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition-[opacity,color,background-color] hover:bg-rose-100 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
          >
            {deleteMutation.isPending ? (
              <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label={`Open ${dashboard.title}`}
            onClick={() => navigate(`/dashboard/${dashboard._id}`)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
          </button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete dashboard</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-medium text-ink">{dashboard.title}</span> along with its chat
              history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
              )}
              Delete dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export default function DashboardPage() {
  const [promptInput, setPromptInput] = useState("");

  const queueItems = useGenerationQueueStore((state) => state.items);
  const enqueue = useGenerationQueueStore((state) => state.enqueue);
  const removeQueueItem = useGenerationQueueStore((state) => state.remove);
  const clearFinished = useGenerationQueueStore((state) => state.clearFinished);

  // Done items live on as saved dashboards — the queue list only shows work
  // that is pending or went wrong.
  const pendingItems = queueItems.filter((item) => item.status !== "done");
  const hasTicking = pendingItems.some((item) => item.status === "waiting");
  const hasFailed = pendingItems.some(
    (item) => item.status === "rejected" || item.status === "error",
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasTicking) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasTicking]);

  const savedDashboardsQuery = useQuery({
    queryKey: ["dashboards", "saved"],
    queryFn: async () => {
      const res = await api.get<{ dashboards: SavedDashboardSummary[] }>("/dashboard/saved");
      return res.data.dashboards;
    },
  });
  const savedDashboards = savedDashboardsQuery.data ?? [];

  function handleGenerate() {
    const prompt = promptInput.trim();
    if (!prompt) return;
    enqueue(prompt);
    setPromptInput("");
  }

  // Recent prompts for one-click reuse: queue items first (newest activity),
  // then saved dashboards' originating prompts, deduped by normalized text.
  const promptHistory = (() => {
    const seen = new Set<string>();
    const history: string[] = [];
    const candidates = [
      ...[...queueItems].sort((a, b) => b.addedAt - a.addedAt).map((item) => item.prompt),
      ...savedDashboards.map((dashboard) => dashboard.prompt),
    ];
    for (const prompt of candidates) {
      const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      history.push(prompt.trim());
    }
    return history;
  })();

  const isEmpty =
    pendingItems.length === 0 && savedDashboards.length === 0 && !savedDashboardsQuery.isLoading;

  return (
    <div>
      <TopBar title="Dashboards" />

      {pendingItems.length > 0 && (
        <Card className="mb-6 animate-fade-in-up">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Generation queue</CardTitle>
              <CardDescription>
                Prompts run one at a time — results land in the list below.
              </CardDescription>
            </div>
            {hasFailed && (
              <Button variant="ghost" size="sm" onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-3">
              {pendingItems.map((item) => (
                <QueueRow key={item.id} item={item} now={now} onRemove={removeQueueItem} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your dashboards</CardTitle>
          <CardDescription>
            Click one to open it — each generation is stored as its own dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {savedDashboardsQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex animate-pulse items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-surface-muted" />
                  <div className="h-3 flex-1 rounded-full bg-surface-muted" />
                  <div className="h-3 w-24 rounded-full bg-surface-muted" />
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-hero-from to-hero-to text-white">
                <HugeiconsIcon icon={SparklesIcon} className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">Describe the dashboard you want</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Type a natural-language prompt in the bar below and we'll turn it into charts
                  and tables. Generations keep running even if you leave this page.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setPromptInput(example)}
                    className="rounded-pill border border-border-soft bg-surface-muted px-4 py-2 text-sm text-ink transition-all duration-150 ease-in-out hover:bg-border-soft active:scale-[0.97]"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : savedDashboards.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              Nothing saved yet — your first generation will appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {savedDashboards.map((dashboard) => (
                <SavedRow key={dashboard._id} dashboard={dashboard} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Breathing room so the floating dock never covers the last list item. */}
      <div className="h-24" aria-hidden="true" />

      <PromptDock
        value={promptInput}
        onValueChange={setPromptInput}
        onSubmit={handleGenerate}
        placeholder={'Describe a dashboard — type "{" for a collection, then "." for its fields'}
        history={promptHistory}
      />
    </div>
  );
}
