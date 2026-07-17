import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isAxiosError } from "axios";
import { generateInsights } from "@/api/overview";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import type { OverviewResponse } from "@/types/overview";

type InsightJobStatus = "queued" | "generating" | "waiting" | "error";

export interface InsightJob {
  id: string;
  ownerUserId: string;
  status: InsightJobStatus;
  retryAt: number | null;
  attempts: number;
  error: string | null;
  startedAt: number;
}

interface InsightJobState {
  job: InsightJob | null;
  generate: () => string | null;
  retry: () => void;
  dismiss: () => void;
}

const BUFFER_MS = 2_000;
const TRANSIENT_DELAY_MS = 5_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export const useInsightJobStore = create<InsightJobState>()(
  persist(
    (set, get) => {
      const patch = (id: string, values: Partial<InsightJob>) =>
        set((state) =>
          state.job?.id === id ? { job: { ...state.job, ...values } } : state,
        );

      const schedule = (id: string, delay: number) => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (get().job?.id === id) {
            patch(id, { status: "queued", retryAt: null });
            process();
          }
        }, Math.max(0, delay));
      };

      const run = async (id: string) => {
        const job = get().job;
        if (!job || job.id !== id || useAuthStore.getState().user?.id !== job.ownerUserId) return;
        patch(id, { status: "generating", error: null, retryAt: null });
        try {
          const result = await generateInsights(id);
          if (useAuthStore.getState().user?.id !== job.ownerUserId) return;
          queryClient.setQueryData<OverviewResponse>(["overview"], (current) =>
            current
              ? {
                  ...current,
                  aiSnapshot: { ...result.snapshot, stale: false },
                  dataFingerprint: result.snapshot.dataFingerprint,
                }
              : current,
          );
          if (get().job?.id === id) set({ job: null });
          void queryClient.invalidateQueries({ queryKey: ["overview"] });
          useNotificationStore.getState().push({
            kind: "success",
            title: "Insights ready",
            body: result.snapshot.summary,
            link: "/overview",
          });
        } catch (error) {
          if (isAxiosError<{ retryAfterMs?: number }>(error) && error.response?.status === 429) {
            const delay = (error.response.data.retryAfterMs ?? 10_000) + BUFFER_MS;
            patch(id, { status: "waiting", retryAt: Date.now() + delay });
            schedule(id, delay);
            return;
          }
          const current = get().job;
          if (!current || current.id !== id) return;
          if (current.attempts < 1) {
            patch(id, {
              status: "waiting",
              retryAt: Date.now() + TRANSIENT_DELAY_MS,
              attempts: current.attempts + 1,
            });
            schedule(id, TRANSIENT_DELAY_MS);
            return;
          }
          patch(id, {
            status: "error",
            retryAt: null,
            error: "Could not generate insights. Try again.",
          });
          useNotificationStore.getState().push({
            kind: "error",
            title: "Insight generation failed",
            body: "Your existing overview is still available.",
            link: "/overview",
          });
        }
      };

      const process = () => {
        const job = get().job;
        if (job?.status === "queued") void run(job.id);
      };
      setTimeout(process, 0);

      return {
        job: null,
        generate: () => {
          if (get().job && get().job?.status !== "error") return get().job?.id ?? null;
          const ownerUserId = useAuthStore.getState().user?.id;
          if (!ownerUserId) return null;
          const job: InsightJob = {
            id: crypto.randomUUID(),
            ownerUserId,
            status: "queued",
            retryAt: null,
            attempts: 0,
            error: null,
            startedAt: Date.now(),
          };
          set({ job });
          process();
          return job.id;
        },
        retry: () => {
          const job = get().job;
          if (!job || job.status !== "error") return;
          patch(job.id, { status: "queued", attempts: 0, error: null });
          process();
        },
        dismiss: () => {
          if (get().job?.status === "error") set({ job: null });
        },
      };
    },
    {
      name: "bijustubu-insight-job",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ job: state.job }),
      merge: (persisted, current) => {
        const stored = persisted as { job?: InsightJob | null } | undefined;
        const job = stored?.job ?? null;
        const userId = useAuthStore.getState().user?.id;
        return {
          ...current,
          job:
            job && job.ownerUserId === userId && job.status !== "error"
              ? { ...job, status: "queued" as const, retryAt: null }
              : job?.ownerUserId === userId
                ? job
                : null,
        };
      },
    },
  ),
);

useAuthStore.subscribe((state) => {
  const job = useInsightJobStore.getState().job;
  if (job && job.ownerUserId !== state.user?.id) useInsightJobStore.setState({ job: null });
});
