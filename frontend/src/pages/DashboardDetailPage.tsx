import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WidgetStack } from "@/components/genui/WidgetStack";
import { DashboardGrid } from "@/components/genui/DashboardGrid";
import { PromptDock } from "@/components/genui/PromptDock";
import { api } from "@/lib/api";
import type { GridRect, RefineDashboardResponse, SavedDashboardDetail, UiSpec } from "@/types/dashboard";
import { formatIsoDate } from "@/components/ui/data-cell";
import { Lottie } from "@/components/ui/lottie";
import loadingAnimation from "@/assets/lottie/loading.lottie";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  CalendarDaysIcon,
  Cancel01Icon,
  DashboardSquareEditIcon,
  Delete02Icon,
  Loading03Icon,
  MagicWand01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

/** Read-only view of one saved generation: title (renamable), prompt, widgets. */
export default function DashboardDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [refineError, setRefineError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState(false);
  const [pendingLayout, setPendingLayout] = useState<Record<string, GridRect> | null>(null);
  // Bumped on cancel to remount the grid and discard unsaved rearrangement.
  const [gridResetKey, setGridResetKey] = useState(0);

  const detailQuery = useQuery({
    queryKey: ["dashboards", "detail", id],
    queryFn: async () => {
      const res = await api.get<SavedDashboardDetail>(`/dashboard/saved/${id}`);
      return res.data;
    },
    enabled: id.length > 0,
    retry: false,
  });

  const renameMutation = useMutation({
    mutationFn: async (title: string) => {
      await api.patch(`/dashboard/saved/${id}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      setEditingTitle(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/dashboard/saved/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboards", "saved"] });
      navigate("/dashboard");
    },
  });

  function submitRename() {
    const title = titleInput.trim();
    if (!title || title === detailQuery.data?.title) {
      setEditingTitle(false);
      return;
    }
    renameMutation.mutate(title);
  }

  const layoutMutation = useMutation({
    mutationFn: async (layout: Record<string, GridRect>) => {
      const res = await api.patch<{ ok: boolean; uiSpec: UiSpec }>(
        `/dashboard/saved/${id}/layout`,
        { layout },
      );
      return res.data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<SavedDashboardDetail>(["dashboards", "detail", id], (old) =>
        old ? { ...old, uiSpec: result.uiSpec } : old,
      );
      setEditingLayout(false);
      setPendingLayout(null);
    },
  });

  function saveLayout() {
    if (!pendingLayout) {
      setEditingLayout(false);
      return;
    }
    layoutMutation.mutate(pendingLayout);
  }

  function cancelLayoutEdit() {
    setEditingLayout(false);
    setPendingLayout(null);
    setGridResetKey((key) => key + 1);
  }

  const refineMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await api.post<RefineDashboardResponse>(`/dashboard/saved/${id}/refine`, {
        prompt,
      });
      return res.data;
    },
    onSuccess: (result) => {
      setChatInput("");
      setRefineError(null);
      // Patch the cached detail in place — no full refetch (queries already ran server-side).
      queryClient.setQueryData<SavedDashboardDetail>(["dashboards", "detail", id], (old) =>
        old
          ? { ...old, uiSpec: result.uiSpec, data: result.data, messages: result.messages }
          : old,
      );
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response) {
        const body = error.response.data as {
          rejected?: boolean;
          reason?: string;
          retryAfterMs?: number;
        };
        if (error.response.status === 400 && body?.rejected) {
          setRefineError(body.reason ?? "That prompt was rejected.");
          return;
        }
        if (error.response.status === 429) {
          const seconds = Math.ceil((body?.retryAfterMs ?? 60_000) / 1000);
          setRefineError(`Rate limited — try again in ~${seconds}s.`);
          return;
        }
      }
      setRefineError("Could not update the dashboard. Try rephrasing your request.");
    },
  });

  function handleRefine() {
    const prompt = chatInput.trim();
    if (!prompt || refineMutation.isPending) return;
    setRefineError(null);
    refineMutation.mutate(prompt);
  }

  const dashboard = detailQuery.data;
  // Page-flow specs (html sections) render seamlessly and are not grid-editable.
  const isPageFlow = dashboard?.uiSpec.widgets.some((widget) => widget.type === "html") ?? false;

  return (
    <div>
      <TopBar title="Dashboards" />

      <div className="mb-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
          <HugeiconsIcon icon={ArrowLeft02Icon} className="h-4 w-4" /> All dashboards
        </Button>
      </div>

      {dashboard && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              {editingTitle ? (
                <div className="flex max-w-xl items-center gap-2">
                  <Input
                    autoFocus
                    value={titleInput}
                    onChange={(event) => setTitleInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitRename();
                      if (event.key === "Escape") setEditingTitle(false);
                    }}
                    className="h-9"
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
                <div className="group flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-ink">
                    {dashboard.title}
                  </h2>
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      setTitleInput(dashboard.title);
                      setEditingTitle(true);
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <HugeiconsIcon icon={PencilEdit02Icon} className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span
                  className="inline-flex shrink-0 items-center gap-1.5"
                  title={dashboard.createdAt}
                >
                  <HugeiconsIcon icon={CalendarDaysIcon} className="h-3.5 w-3.5" />
                  {formatIsoDate(dashboard.createdAt)}
                </span>
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1"
                  title={dashboard.prompt}
                >
                  <HugeiconsIcon icon={MagicWand01Icon} className="h-3 w-3 shrink-0" />
                  <span className="truncate">{dashboard.prompt}</span>
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!isPageFlow && !editingLayout && (
                <Button variant="outline" size="sm" onClick={() => setEditingLayout(true)}>
                  <HugeiconsIcon icon={DashboardSquareEditIcon} className="h-4 w-4" /> Edit layout
                </Button>
              )}
              {editingLayout && (
                <>
                  <Button variant="ghost" size="sm" onClick={cancelLayoutEdit} disabled={layoutMutation.isPending}>
                    <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" /> Cancel
                  </Button>
                  <Button size="sm" onClick={saveLayout} disabled={layoutMutation.isPending}>
                    {layoutMutation.isPending ? (
                      <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
                    ) : (
                      <HugeiconsIcon icon={Tick02Icon} className="h-4 w-4" />
                    )}
                    Save layout
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-600"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                )}
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {dashboard && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="w-full max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete dashboard</DialogTitle>
              <DialogDescription>
                This permanently deletes{" "}
                <span className="font-medium text-ink">{dashboard.title}</span> along with its
                chat history. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
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
      )}

      {detailQuery.isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10">
            <Lottie src={loadingAnimation} className="h-16 w-16" />
            <p className="text-sm text-ink-muted">Loading dashboard…</p>
          </CardContent>
        </Card>
      )}

      {detailQuery.isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-ink-muted">
              This dashboard no longer exists — it may have been deleted.
            </p>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              <HugeiconsIcon icon={ArrowLeft02Icon} className="h-4 w-4" /> Back to all dashboards
            </Button>
          </CardContent>
        </Card>
      )}

      {dashboard &&
        (isPageFlow ? (
          <WidgetStack uiSpec={dashboard.uiSpec} data={dashboard.data} />
        ) : (
          <DashboardGrid
            key={gridResetKey}
            uiSpec={dashboard.uiSpec}
            data={dashboard.data}
            editing={editingLayout}
            onLayoutChange={setPendingLayout}
          />
        ))}

      {/* Breathing room so the floating dock never covers the page tail. */}
      <div className="h-24" aria-hidden="true" />

      {dashboard && (
        <PromptDock
          value={chatInput}
          onValueChange={setChatInput}
          onSubmit={handleRefine}
          busy={refineMutation.isPending}
          busyLabel="Updating the dashboard…"
          error={refineError}
          submitLabel="Update"
          placeholder={'Describe a change — e.g. "make the bar chart a line chart and add a total revenue stat"'}
          chat={{
            messages: dashboard.messages,
            pendingPrompt: refineMutation.isPending ? refineMutation.variables : null,
            pendingLabel: "Updating the dashboard…",
          }}
        />
      )}
    </div>
  );
}
