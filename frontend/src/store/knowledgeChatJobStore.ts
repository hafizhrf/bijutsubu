import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isAxiosError } from "axios";
import { sendKnowledgeChat } from "@/api/knowledge";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import type { KbChatMessage } from "@/types/knowledge";

export type KnowledgeChatJobStatus = "queued" | "thinking" | "waiting" | "error";

export interface KnowledgeChatJob {
  id: string;
  ownerUserId: string;
  message: string;
  status: KnowledgeChatJobStatus;
  retryAt: number | null;
  attempts: number;
  error: string | null;
  startedAt: number;
}

interface KnowledgeChatJobState {
  job: KnowledgeChatJob | null;
  send: (message: string) => string | null;
  retry: () => void;
  dismiss: () => void;
  complete: (requestId: string) => void;
}

interface ChatErrorBody {
  error?: string;
  retryAfterMs?: number;
}

const RATE_LIMIT_BUFFER_MS = 2_000;
const TRANSIENT_RETRY_DELAY_MS = 5_000;
const MAX_TRANSIENT_RETRIES = 1;

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function isActive(job: KnowledgeChatJob | null): boolean {
  return Boolean(job && job.status !== "error");
}

function sanitizeRehydratedJob(job: KnowledgeChatJob | null): KnowledgeChatJob | null {
  if (!job) return null;
  const currentUserId = useAuthStore.getState().user?.id;
  if (!currentUserId || job.ownerUserId !== currentUserId) return null;
  if (job.status === "error") return job;
  // The original browser request may still finish server-side. Replaying the
  // same stable id is safe because the backend stores the response idempotently.
  return { ...job, status: "queued", retryAt: null };
}

export const useKnowledgeChatJobStore = create<KnowledgeChatJobState>()(
  persist(
    (set, get) => {
      const patchJob = (id: string, patch: Partial<KnowledgeChatJob>) => {
        set((state) =>
          state.job?.id === id ? { job: { ...state.job, ...patch } } : state,
        );
      };

      const scheduleRetry = (id: string, delayMs: number) => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          const job = get().job;
          if (job?.id === id && job.status === "waiting") {
            patchJob(id, { status: "queued", retryAt: null });
            processNext();
          }
        }, Math.max(0, delayMs));
      };

      const runJob = async (id: string) => {
        const job = get().job;
        const currentUserId = useAuthStore.getState().user?.id;
        if (!job || job.id !== id || job.ownerUserId !== currentUserId) {
          if (job?.id === id) set({ job: null });
          return;
        }

        patchJob(id, { status: "thinking", retryAt: null, error: null });

        try {
          const result = await sendKnowledgeChat(job.message, job.id);

          // Do not leak an old user's completion into a newly authenticated
          // session in the same tab.
          if (useAuthStore.getState().user?.id !== job.ownerUserId) {
            if (get().job?.id === id) set({ job: null });
            return;
          }

          queryClient.setQueryData<{ messages: KbChatMessage[] }>(
            ["knowledge", "chat"],
            (current) => {
              const messages = (current?.messages ?? []).filter(
                (message) => message.requestId !== job.id,
              );
              return {
                messages: [...messages, result.userMessage, result.message].sort(
                  (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
                ),
              };
            },
          );
          if (get().job?.id === id) set({ job: null });
          void queryClient.invalidateQueries({ queryKey: ["knowledge", "chat"] });
          useNotificationStore.getState().push({
            kind: "success",
            title: "Knowledge answer ready",
            body: job.message,
            link: "/knowledge",
          });
        } catch (error) {
          if (isAxiosError<ChatErrorBody>(error) && error.response?.status === 429) {
            const retryAfterMs = error.response.data?.retryAfterMs ?? 10_000;
            const retryAt = Date.now() + retryAfterMs + RATE_LIMIT_BUFFER_MS;
            patchJob(id, { status: "waiting", retryAt });
            scheduleRetry(id, retryAt - Date.now());
            return;
          }

          const current = get().job;
          if (!current || current.id !== id) return;
          if (current.attempts < MAX_TRANSIENT_RETRIES) {
            const retryAt = Date.now() + TRANSIENT_RETRY_DELAY_MS;
            patchJob(id, {
              status: "waiting",
              retryAt,
              attempts: current.attempts + 1,
            });
            scheduleRetry(id, TRANSIENT_RETRY_DELAY_MS);
            return;
          }

          const message =
            isAxiosError(error) && error.response?.status === 502
              ? "Knowledge service is unreachable — try again shortly."
              : "Could not get an answer. Try again.";
          patchJob(id, { status: "error", retryAt: null, error: message });
          useNotificationStore.getState().push({
            kind: "error",
            title: "Knowledge chat failed",
            body: job.message,
            link: "/knowledge",
          });
        }
      };

      const processNext = () => {
        const job = get().job;
        if (!job || job.status !== "queued") return;
        void runJob(job.id);
      };

      // Resume a persisted job after hydration/reload.
      setTimeout(processNext, 0);

      return {
        job: null,

        send: (message) => {
          const normalized = message.trim();
          if (!normalized) return null;
          const current = get().job;
          if (isActive(current)) return current?.id ?? null;
          const ownerUserId = useAuthStore.getState().user?.id;
          if (!ownerUserId) return null;

          const job: KnowledgeChatJob = {
            id: crypto.randomUUID(),
            ownerUserId,
            message: normalized,
            status: "queued",
            retryAt: null,
            attempts: 0,
            error: null,
            startedAt: Date.now(),
          };
          set({ job });
          processNext();
          return job.id;
        },

        retry: () => {
          const job = get().job;
          if (!job || job.status !== "error") return;
          patchJob(job.id, { status: "queued", attempts: 0, error: null });
          processNext();
        },

        dismiss: () => {
          if (get().job?.status === "error") set({ job: null });
        },

        complete: (requestId) => {
          if (get().job?.id !== requestId) return;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          set({ job: null });
        },
      };
    },
    {
      name: "bijustubu-knowledge-chat-job",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ job: state.job }),
      merge: (persisted, current) => {
        const stored = persisted as { job?: KnowledgeChatJob | null } | undefined;
        return { ...current, job: sanitizeRehydratedJob(stored?.job ?? null) };
      },
    },
  ),
);

// A session-scoped pending bubble must never cross account boundaries when a
// user logs out and another user signs in in the same browser tab.
useAuthStore.subscribe((state) => {
  const job = useKnowledgeChatJobStore.getState().job;
  if (job && job.ownerUserId !== state.user?.id) {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    useKnowledgeChatJobStore.setState({ job: null });
  }
});
