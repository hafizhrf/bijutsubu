import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isAxiosError } from "axios";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useNotificationStore } from "@/store/notificationStore";
import type {
  GenerateDashboardRequest,
  GenerateDashboardResponse,
  RejectedResponse,
} from "@/types/dashboard";

export type GenerationStatus =
  | "queued"
  | "generating"
  | "waiting"
  | "done"
  | "rejected"
  | "error";

/** Server-reported step of an in-flight generation (polled, best-effort). */
export type GenerationStage = "guarding" | "designing" | "executing" | "saving";

export interface GenerationItem {
  id: string;
  prompt: string;
  /** Auto-derived from the prompt at enqueue time; the saved dashboard gets
   *  the LLM's own title and can be renamed there. */
  title: string;
  status: GenerationStatus;
  /** Progress step while status is "generating"; null when unknown (poll 404 / older server). */
  stage: GenerationStage | null;
  /** Epoch ms when a "waiting" item will retry (rate limit or transient error). */
  retryAt: number | null;
  /** MetaDashboard id once the generation finished and was auto-saved. */
  savedId: string | null;
  /** Rejection reason (400) or error message. */
  reason: string | null;
  /** Transient (500/network) retries already consumed for this item. */
  attempts: number;
  addedAt: number;
}

interface GenerationQueueState {
  items: GenerationItem[];
  isProcessing: boolean;
  enqueue: (prompt: string) => string;
  remove: (id: string) => void;
  clearFinished: () => void;
}

interface GenerateErrorBody {
  error?: string;
  retryAfterMs?: number;
}

const RATE_LIMIT_BUFFER_MS = 2_000;
const TRANSIENT_RETRY_DELAY_MS = 5_000;
const MAX_TRANSIENT_RETRIES = 1;
/** Keep the queue short: drop the oldest finished items when enqueueing past this. */
const MAX_ITEMS = 15;

const TERMINAL_STATUSES: GenerationStatus[] = ["done", "rejected", "error"];

function isTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Working title shown in the queue list until the saved dashboard takes over. */
export function deriveTitleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  const truncated = compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

function notifyTerminal(item: GenerationItem): void {
  const { push } = useNotificationStore.getState();
  if (item.status === "done") {
    push({
      kind: "success",
      title: "Dashboard ready",
      body: item.title,
      link: item.savedId ? `/dashboard/${item.savedId}` : "/dashboard",
    });
  } else if (item.status === "rejected") {
    push({
      kind: "info",
      title: "Prompt rejected",
      body: item.reason ?? "That prompt couldn't be turned into a dashboard.",
      link: "/dashboard",
    });
  } else if (item.status === "error") {
    push({
      kind: "error",
      title: "Generation failed",
      body: item.title,
      link: "/dashboard",
    });
  }
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const progressTimers = new Map<string, ReturnType<typeof setInterval>>();

const PROGRESS_POLL_MS = 1_500;

/** In-flight statuses go back to queued after a reload — prompts are all we
 *  need to resume, so nothing is lost. */
function sanitizeRehydratedItems(items: GenerationItem[]): GenerationItem[] {
  return items.map((item) => ({
    ...item,
    // Items persisted before `stage` existed rehydrate without the field.
    stage: null,
    ...(item.status === "generating" || item.status === "waiting"
      ? { status: "queued" as const, retryAt: null }
      : {}),
  }));
}

export const useGenerationQueueStore = create<GenerationQueueState>()(
  persist(
    (set, get) => {
      const patchItem = (id: string, patch: Partial<GenerationItem>) => {
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        }));
      };

      /** Best-effort stage polling while a generation is in flight; a 404
       *  poll (finished/restart/other instance) just leaves stage at null. */
      const startProgressPolling = (id: string) => {
        stopProgressPolling(id);
        progressTimers.set(
          id,
          setInterval(async () => {
            try {
              const res = await api.get<{ stage: GenerationStage }>(
                `/dashboard/generate/${id}/progress`,
              );
              patchItem(id, { stage: res.data.stage });
            } catch {
              // Not fatal — the UI falls back to the indeterminate spinner.
            }
          }, PROGRESS_POLL_MS),
        );
      };

      const stopProgressPolling = (id: string) => {
        const timer = progressTimers.get(id);
        if (timer) {
          clearInterval(timer);
          progressTimers.delete(id);
        }
      };

      /** Marks an item terminal, pushes its notification, and frees the pipeline. */
      const finishItem = (id: string, patch: Partial<GenerationItem>) => {
        stopProgressPolling(id);
        patchItem(id, { stage: null, ...patch });
        set({ isProcessing: false });
        const item = get().items.find((entry) => entry.id === id);
        if (item) notifyTerminal(item);
        processNext();
      };

      /** Re-queues a waiting item once its delay elapses, then kicks the loop. */
      const scheduleRetry = (id: string, delayMs: number) => {
        const existing = retryTimers.get(id);
        if (existing) clearTimeout(existing);
        retryTimers.set(
          id,
          setTimeout(() => {
            retryTimers.delete(id);
            const item = get().items.find((entry) => entry.id === id);
            if (item && item.status === "waiting") {
              patchItem(id, { status: "queued", retryAt: null });
            }
            processNext();
          }, Math.max(0, delayMs)),
        );
      };

      const runGeneration = async (id: string) => {
        const item = get().items.find((entry) => entry.id === id);
        if (!item) {
          set({ isProcessing: false });
          processNext();
          return;
        }

        patchItem(id, { status: "generating", retryAt: null, reason: null, stage: null });
        startProgressPolling(id);

        try {
          const request = {
            prompt: item.prompt,
            // Stable across navigation, retries, and session rehydration so the
            // backend can collapse every replay into one saved dashboard.
            requestId: item.id,
          } satisfies GenerateDashboardRequest;
          const res = await api.post<GenerateDashboardResponse>("/dashboard/generate", request);
          // The server saved the dashboard already — the saved list is the
          // source of truth from here on.
          finishItem(id, {
            status: "done",
            savedId: res.data.dashboard._id,
            title: res.data.dashboard.title,
          });
          void queryClient.invalidateQueries({ queryKey: ["dashboards", "saved"] });
        } catch (error) {
          if (isAxiosError<RejectedResponse | GenerateErrorBody>(error) && error.response) {
            const status = error.response.status;
            const body = error.response.data;

            if (status === 400 && body && "rejected" in body && body.rejected) {
              // Rejections don't consume server quota — record the reason and move on.
              finishItem(id, { status: "rejected", reason: body.reason });
              return;
            }

            if (status === 429) {
              // Rate limited: wait exactly as long as the server asks (plus a buffer),
              // then retry this same item. Nothing else generates in the meantime.
              const retryAfterMs =
                body && "retryAfterMs" in body && typeof body.retryAfterMs === "number"
                  ? body.retryAfterMs
                  : 60_000;
              const retryAt = Date.now() + retryAfterMs + RATE_LIMIT_BUFFER_MS;
              stopProgressPolling(id);
              patchItem(id, { status: "waiting", retryAt, stage: null });
              set({ isProcessing: false });
              scheduleRetry(id, retryAt - Date.now());
              return;
            }
          }

          // 500 / network: retry once after a short delay, then give up on this item.
          const current = get().items.find((entry) => entry.id === id);
          const attempts = current?.attempts ?? 0;
          if (attempts < MAX_TRANSIENT_RETRIES) {
            const retryAt = Date.now() + TRANSIENT_RETRY_DELAY_MS;
            stopProgressPolling(id);
            patchItem(id, { status: "waiting", retryAt, attempts: attempts + 1, stage: null });
            set({ isProcessing: false });
            scheduleRetry(id, TRANSIENT_RETRY_DELAY_MS);
          } else {
            finishItem(id, {
              status: "error",
              reason: "Something went wrong generating this dashboard, even after a retry.",
            });
          }
        }
      };

      /**
       * Strictly sequential FIFO loop. Safe to call from anywhere, any number of
       * times: it no-ops if a generation is in flight or an item is waiting on a
       * scheduled retry (that retry owns the pipeline to preserve FIFO order and
       * respect the server rate limit).
       */
      const processNext = () => {
        const state = get();
        if (state.isProcessing) return;
        if (state.items.some((item) => item.status === "waiting")) return;
        const next = state.items.find((item) => item.status === "queued");
        if (!next) return;
        set({ isProcessing: true });
        void runGeneration(next.id);
      };

      // Resume queued prompts that survived a reload.
      setTimeout(processNext, 0);

      return {
        items: [],
        isProcessing: false,

        enqueue: (prompt) => {
          const normalizedPrompt = prompt.trim();
          const activeDuplicate = get().items.find(
            (item) => !isTerminal(item.status) && item.prompt === normalizedPrompt,
          );
          if (activeDuplicate) return activeDuplicate.id;

          const newItem: GenerationItem = {
            id: crypto.randomUUID(),
            prompt: normalizedPrompt,
            title: deriveTitleFromPrompt(normalizedPrompt),
            status: "queued",
            stage: null,
            retryAt: null,
            savedId: null,
            reason: null,
            attempts: 0,
            addedAt: Date.now(),
          };
          set((state) => {
            let items = [...state.items, newItem];
            let overflow = items.length - MAX_ITEMS;
            if (overflow > 0) {
              items = items.filter((item) => {
                if (overflow > 0 && isTerminal(item.status)) {
                  overflow -= 1;
                  return false;
                }
                return true;
              });
            }
            return { items };
          });
          processNext();
          return newItem.id;
        },

        remove: (id) => {
          const item = get().items.find((entry) => entry.id === id);
          if (!item || item.status === "generating") return;
          const timer = retryTimers.get(id);
          if (timer) {
            clearTimeout(timer);
            retryTimers.delete(id);
          }
          set((state) => ({ items: state.items.filter((entry) => entry.id !== id) }));
          processNext();
        },

        clearFinished: () => {
          set((state) => ({
            items: state.items.filter((item) => !isTerminal(item.status)),
          }));
        },
      };
    },
    {
      name: "bijustubu-generation-queue",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ items: state.items }),
      merge: (persisted, current) => {
        const stored = persisted as { items?: GenerationItem[] } | undefined;
        return { ...current, items: sanitizeRehydratedItems(stored?.items ?? []) };
      },
    },
  ),
);
