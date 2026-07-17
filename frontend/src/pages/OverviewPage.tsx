import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  DashboardCircleIcon,
  Database01Icon,
  Loading03Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { getOverview } from "@/api/overview";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { useAuthStore } from "@/store/authStore";
import { useGenerationQueueStore } from "@/store/generationQueueStore";
import { useInsightJobStore } from "@/store/insightJobStore";
import { useKnowledgeChatJobStore } from "@/store/knowledgeChatJobStore";
import { useUploadQueueStore } from "@/store/uploadQueueStore";
import type { AiInsightItem, InsightSeverity } from "@/types/overview";

const severityClass: Record<InsightSeverity, string> = {
  info: "bg-accent-blue/10 text-accent-blue",
  opportunity: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
};

const QUICK_ACTIONS = [
  { label: "Import data", description: "Create structured collections", to: "/documents", icon: CloudUploadIcon },
  { label: "Build dashboard", description: "Turn data into a visual report", to: "/dashboard", icon: DashboardCircleIcon },
  { label: "Add knowledge", description: "Upload documents for grounded chat", to: "/knowledge", icon: BookOpen01Icon },
];

function aiAction(item: AiInsightItem): { label: string; to: string } | null {
  switch (item.action) {
    case "open-collection":
      return item.collectionName
        ? { label: "Open collection", to: `/collections?c=${encodeURIComponent(item.collectionName)}` }
        : null;
    case "import-data":
      return { label: "Import data", to: "/documents" };
    case "create-dashboard":
      return { label: "Create dashboard", to: "/dashboard" };
    case "open-knowledge":
      return { label: "Open knowledge", to: "/knowledge" };
    default:
      return null;
  }
}

export default function OverviewPage() {
  const user = useAuthStore((state) => state.user);
  const uploadItems = useUploadQueueStore((state) => state.items);
  const generationItems = useGenerationQueueStore((state) => state.items);
  const knowledgeJob = useKnowledgeChatJobStore((state) => state.job);
  const insightJob = useInsightJobStore((state) => state.job);
  const generate = useInsightJobStore((state) => state.generate);
  const retryInsight = useInsightJobStore((state) => state.retry);
  const dismissInsight = useInsightJobStore((state) => state.dismiss);

  const overviewQuery = useQuery({ queryKey: ["overview"], queryFn: getOverview });
  const overview = overviewQuery.data;
  const activeUploads = uploadItems.filter((item) => !["done", "error", "canceled"].includes(item.status)).length;
  const activeGenerations = generationItems.filter((item) => !["done", "error", "rejected"].includes(item.status)).length;
  const activeKnowledge = knowledgeJob && knowledgeJob.status !== "error" ? 1 : 0;
  const activeInsights = insightJob && insightJob.status !== "error" ? 1 : 0;
  const activeJobs = activeUploads + activeGenerations + activeKnowledge + activeInsights;
  const jobLinks = [
    activeUploads > 0 ? { label: `${activeUploads} upload${activeUploads === 1 ? "" : "s"}`, to: "/documents" } : null,
    activeGenerations > 0 ? { label: `${activeGenerations} dashboard${activeGenerations === 1 ? "" : "s"}`, to: "/dashboard" } : null,
    activeKnowledge > 0 ? { label: "Knowledge answer", to: "/knowledge?tab=chat" } : null,
    activeInsights > 0 ? { label: "AI insights", to: "/overview" } : null,
  ].filter((entry): entry is { label: string; to: string } => entry !== null);

  const metrics = overview
    ? [
        { label: "Collections", value: overview.metrics.collections, icon: Database01Icon },
        { label: "Rows", value: overview.metrics.rows, icon: Activity01Icon },
        { label: "Relations", value: overview.metrics.relations, icon: SparklesIcon },
        { label: "Dashboards", value: overview.metrics.dashboards, icon: DashboardCircleIcon },
        {
          label: "Knowledge docs",
          value: overview.metrics.knowledgeDocuments,
          icon: BookOpen01Icon,
        },
      ]
    : [];
  const isEmpty = overview ? overview.metrics.collections === 0 : false;
  const workspaceName =
    user?.displayName || user?.email?.split("@")[0] || "Personal workspace";
  const workspaceInitial = workspaceName[0]?.toUpperCase() ?? "?";

  return (
    <div>
      <TopBar title="Overview" />

      <section className="mb-6 flex flex-col gap-4 rounded-card border border-border-soft bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar text-lg font-bold text-sidebar-ink">
            {workspaceInitial}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Personal workspace
            </p>
            <h2 className="truncate text-xl font-bold tracking-tight text-ink">
              {workspaceName}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {overview
                ? `${overview.metrics.collections.toLocaleString()} collections · ${overview.metrics.rows.toLocaleString()} rows · ${overview.metrics.dashboards.toLocaleString()} dashboards`
                : "Workspace summary"}
            </p>
          </div>
        </div>
        {activeJobs > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full bg-sidebar px-3 py-1.5 text-xs font-medium text-sidebar-ink">
              <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
              {activeJobs} running
            </span>
            {jobLinks.map((entry) => (
              <Link
                key={entry.label}
                to={entry.to}
                className="rounded-full bg-surface-muted px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-border-soft hover:text-ink"
              >
                {entry.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      {overviewQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      ) : overviewQuery.isError || !overview ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-rose-600">
            Could not load your workspace overview. Please try again.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map((metric) => (
              <Card key={metric.label} className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-muted">{metric.label}</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
                    <HugeiconsIcon icon={metric.icon} className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
                  {metric.value === null ? "—" : metric.value.toLocaleString()}
                </p>
              </Card>
            ))}
          </div>

          {isEmpty && (
            <Card className="mt-6 border-dashed">
              <CardHeader>
                <CardTitle>Set up your workspace</CardTitle>
                <CardDescription>Complete these steps to unlock useful analysis.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
                {[
                  ["1", "Import structured data", "/documents"],
                  ["2", "Explore your collection", "/collections"],
                  ["3", "Generate a dashboard", "/dashboard"],
                ].map(([step, label, to]) => (
                  <Link
                    key={step}
                    to={to}
                    className="flex items-center gap-3 rounded-2xl border border-border-soft p-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-xs font-bold text-sidebar-ink">
                      {step}
                    </span>
                    {label}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-12">
            <Card className="xl:col-span-8">
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="flex flex-col gap-1.5">
                  <CardTitle>Workspace insights</CardTitle>
                  <CardDescription>
                    Reliable checks are always available; AI analysis runs only when requested.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => generate()}
                  disabled={Boolean(insightJob && insightJob.status !== "error")}
                >
                  {insightJob && insightJob.status !== "error" ? (
                    <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
                  ) : (
                    <HugeiconsIcon icon={SparklesIcon} className="h-4 w-4" />
                  )}
                  {overview.aiSnapshot ? "Refresh AI insights" : "Generate AI insights"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-5 pt-0">
                {insightJob?.status === "error" && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
                    <span>{insightJob.error}</span>
                    <span className="flex gap-2">
                      <button onClick={retryInsight} className="font-semibold hover:underline">Retry</button>
                      <button onClick={dismissInsight} className="hover:underline">Dismiss</button>
                    </span>
                  </div>
                )}

                {overview.aiSnapshot && (
                  <section className="rounded-2xl border border-accent-blue/20 bg-accent-blue/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-accent-blue/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-blue">AI snapshot</span>
                      {overview.aiSnapshot.stale && (
                        <span className="text-xs text-amber-700">Data changed since this was generated</span>
                      )}
                      <time className="ml-auto text-xs text-ink-muted">
                        {timeAgo(Date.parse(overview.aiSnapshot.generatedAt))}
                      </time>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-ink">{overview.aiSnapshot.summary}</p>
                    <div className="mt-3 space-y-2">
                      {overview.aiSnapshot.items.map((item, index) => {
                        const action = aiAction(item);
                        return (
                          <div key={`${item.title}-${index}`} className="rounded-xl bg-surface p-3">
                            <div className="flex items-start gap-3">
                              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", severityClass[item.severity])} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-ink">{item.title}</p>
                                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{item.description}</p>
                              </div>
                              {action && <Link to={action.to} className="shrink-0 text-xs font-semibold text-accent-blue hover:underline">{action.label}</Link>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Live checks</p>
                  <div className="space-y-2">
                    {overview.findings.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4" /> No immediate issues found.
                      </div>
                    ) : (
                      overview.findings.map((finding) => (
                        <div key={finding.id} className="flex items-start gap-3 rounded-2xl border border-border-soft p-4">
                          <span className={cn("mt-0.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase", severityClass[finding.severity])}>{finding.severity}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">{finding.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{finding.description}</p>
                          </div>
                          {finding.action && <Link to={finding.action.to} className="shrink-0 text-xs font-semibold text-accent-blue hover:underline">{finding.action.label}</Link>}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </CardContent>
            </Card>

            <div className="space-y-6 xl:col-span-4">
              <Card>
                <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {QUICK_ACTIONS.map(({ label, description, to, icon }) => (
                    <Link key={label} to={to} className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-surface-muted">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-ink-muted"><HugeiconsIcon icon={icon} className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{label}</span><span className="block truncate text-xs text-ink-muted">{description}</span></span>
                      <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 text-ink-muted" />
                    </Link>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Recent activity</CardTitle>
                  <Link to="/logs" className="text-xs font-semibold text-accent-blue hover:underline">View all</Link>
                </CardHeader>
                <CardContent className="pt-0">
                  {overview.recentActivity.length === 0 ? (
                    <p className="py-4 text-center text-sm text-ink-muted">No activity yet.</p>
                  ) : (
                    <ol className="space-y-3">
                      {overview.recentActivity.map((entry) => (
                        <li key={entry._id} className="flex items-start gap-3">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-blue" />
                          <div className="min-w-0 flex-1"><p className="truncate text-sm text-ink" title={entry.summary}>{entry.summary}</p><time className="text-[11px] text-ink-muted">{timeAgo(Date.parse(entry.createdAt))}</time></div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
