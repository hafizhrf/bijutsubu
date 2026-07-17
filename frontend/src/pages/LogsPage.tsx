import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivity } from "@/api/activity";
import type { ActivityEntry } from "@/api/activity";
import { cn } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lottie } from "@/components/ui/lottie";
import loadingAnimation from "@/assets/lottie/loading.lottie";
import emptyAstronaut from "@/assets/lottie/empty-astronaut.lottie";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ColumnInsertIcon,
  Database01Icon,
  FileUploadIcon,
  GitMergeIcon,
  InsertRowIcon,
  Loading03Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

const PAGE_SIZE = 50;

interface CategoryStyle {
  icon: typeof SparklesIcon;
  bubble: string;
}

/** Icon + bubble color per action prefix (action names are "<prefix>-<verb>"). */
const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  document: { icon: FileUploadIcon, bubble: "bg-amber-100 text-amber-700" },
  row: { icon: InsertRowIcon, bubble: "bg-accent-blue/10 text-accent-blue" },
  field: { icon: ColumnInsertIcon, bubble: "bg-violet-100 text-violet-700" },
  collection: { icon: Database01Icon, bubble: "bg-rose-100 text-rose-700" },
  relation: { icon: GitMergeIcon, bubble: "bg-emerald-100 text-emerald-700" },
  dashboard: { icon: SparklesIcon, bubble: "bg-fuchsia-100 text-fuchsia-700" },
};

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "document", label: "Uploads" },
  { value: "row", label: "Rows" },
  { value: "field", label: "Fields" },
  { value: "collection", label: "Collections" },
  { value: "relation", label: "Relations" },
  { value: "dashboard", label: "Dashboards" },
];

function categoryOf(action: string): CategoryStyle {
  const prefix = action.split("-")[0];
  return CATEGORY_STYLES[prefix] ?? { icon: Database01Icon, bubble: "bg-surface-muted text-ink-muted" };
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
  const groups: { label: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

export default function LogsPage() {
  const [prefix, setPrefix] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const activityQuery = useQuery({
    queryKey: ["activity", prefix, limit],
    queryFn: () => getActivity({ prefix, limit }),
    placeholderData: (previous) => previous,
  });

  const entries = activityQuery.data?.entries ?? [];
  const total = activityQuery.data?.total ?? 0;
  const groups = groupByDay(entries);

  return (
    <div>
      <TopBar title="Activity" />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              Everything that happened to your data — uploads, edits, relations, generations.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setPrefix(filter.value);
                  setLimit(PAGE_SIZE);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  prefix === filter.value
                    ? "bg-sidebar text-sidebar-ink"
                    : "bg-surface-muted text-ink-muted hover:bg-border-soft hover:text-ink",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {activityQuery.isLoading ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <Lottie src={loadingAnimation} className="h-16 w-16" />
              <p className="text-sm text-ink-muted">Loading activity…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-8">
              <Lottie src={emptyAstronaut} className="h-40 w-40" />
              <p className="text-sm text-ink-muted">
                Nothing logged{prefix ? " in this category" : ""} yet — activity shows up here as
                you work with your data.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.label}>
                  <h3 className="sticky top-0 z-10 -mx-2 mb-2 bg-surface/95 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ink-muted backdrop-blur">
                    {group.label}
                  </h3>
                  <ol className="relative flex flex-col">
                    {group.entries.map((entry, index) => {
                      const { icon, bubble } = categoryOf(entry.action);
                      return (
                        <li key={entry._id} className="relative flex gap-3 pb-4 last:pb-0">
                          {/* timeline spine */}
                          {index < group.entries.length - 1 && (
                            <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border-soft" />
                          )}
                          <span
                            className={cn(
                              "z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                              bubble,
                            )}
                          >
                            <HugeiconsIcon icon={icon} className="h-3.5 w-3.5" />
                          </span>
                          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pt-1.5">
                            <p className="min-w-0 text-sm text-ink">{entry.summary}</p>
                            <time
                              dateTime={entry.createdAt}
                              className="shrink-0 text-xs tabular-nums text-ink-muted"
                            >
                              {timeLabel(entry.createdAt)}
                            </time>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}

              {entries.length < total && (
                <Button
                  variant="outline"
                  className="self-center"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                  disabled={activityQuery.isFetching}
                >
                  {activityQuery.isFetching && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
                  Load more ({entries.length} of {total})
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
