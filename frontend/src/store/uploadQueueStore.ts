import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isAxiosError } from "axios";
import { applyUpload, cancelUpload, planUpload } from "@/api/documents";
import { queryClient } from "@/lib/queryClient";
import { useNotificationStore } from "@/store/notificationStore";
import type {
  ApplyDecision,
  SimilarCollection,
  SqlDumpSummary,
  UploadApplied,
  UploadPlan,
  UploadPreview,
} from "@/types/collections";

export type QueueItemStatus =
  | "queued"
  | "uploading"
  | "waiting"
  | "needs-decision"
  | "done"
  | "error"
  | "canceled";

export interface PendingDecision {
  pendingId: string;
  expiresAt: string;
  plan: UploadPlan;
  /** Present for staged SQL dumps: multi-collection import summary. */
  sqlSummary?: SqlDumpSummary;
  similarityNote: string | null;
  similarCollections: SimilarCollection[];
  preview: UploadPreview;
}

export interface QueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  /** null after a page reload — File objects can't be persisted. */
  file: File | null;
  /** Snapshot of the instruction field at enqueue time. */
  instruction: string;
  status: QueueItemStatus;
  /** Epoch ms when a "waiting" item will retry (rate limit or transient error). */
  retryAt: number | null;
  result: UploadApplied | null;
  /** Staged server-side plan awaiting the user's merge/skip/create choice. */
  pending: PendingDecision | null;
  /** Remembered so a rate-limited apply can be replayed automatically. */
  decision: ApplyDecision | null;
  errorMessage: string | null;
  /** Transient (500/network) retries already consumed for this item. */
  attempts: number;
  addedAt: number;
}

interface UploadQueueState {
  items: QueueItem[];
  isProcessing: boolean;
  enqueue: (files: File[], instruction: string) => void;
  resolveDecision: (id: string, decision: ApplyDecision) => void;
  skipDecision: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

interface UploadErrorBody {
  error?: string;
  retryAfterMs?: number;
}

const RATE_LIMIT_BUFFER_MS = 2_000;
const TRANSIENT_RETRY_DELAY_MS = 5_000;
const MAX_TRANSIENT_RETRIES = 1;

function hardErrorMessage(code: string | undefined): string {
  switch (code) {
    case "unsupported_file_type":
      return "This file type isn't supported.";
    case "file_too_large":
      return "This file is too large.";
    case "unparsable_file":
      return "We couldn't read this file. Try a different format.";
    default:
      return "Upload failed. Remove this file and try again.";
  }
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

const RELOAD_LOST_MESSAGE =
  "This file didn't survive the page reload — add it again to retry.";

/**
 * File objects can't be serialized, so after a reload any item that still
 * needed its bytes becomes an error. needs-decision items keep working: their
 * rows are staged server-side, so apply/skip don't need the File.
 */
function sanitizeRehydratedItems(items: QueueItem[]): QueueItem[] {
  return items.map((item) => {
    const base = { ...item, file: null, retryAt: null };
    if (item.status === "queued" || item.status === "uploading" || item.status === "waiting") {
      return { ...base, status: "error" as const, errorMessage: RELOAD_LOST_MESSAGE };
    }
    return base;
  });
}

export const useUploadQueueStore = create<UploadQueueState>()(
  persist(
    (set, get) => {
  const patchItem = (id: string, patch: Partial<QueueItem>) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  /**
   * Re-runs a waiting item once its delay elapses. Items with a saved
   * decision replay the apply call; everything else goes back to queued and
   * lets the FIFO loop re-plan it.
   */
  const scheduleRetry = (id: string, delayMs: number) => {
    const existing = retryTimers.get(id);
    if (existing) clearTimeout(existing);
    retryTimers.set(
      id,
      setTimeout(() => {
        retryTimers.delete(id);
        const item = get().items.find((entry) => entry.id === id);
        if (item && item.status === "waiting") {
          if (item.pending && item.decision) {
            void runApply(id);
            return;
          }
          patchItem(id, { status: "queued", retryAt: null });
        }
        processNext();
      }, Math.max(0, delayMs)),
    );
  };

  const finishSuccess = (id: string, fileName: string, result: UploadApplied) => {
    patchItem(id, {
      status: "done",
      result,
      pending: null,
      decision: null,
      retryAt: null,
    });
    const stats: string[] = [];
    if (result.collection.insertedCount > 0) {
      stats.push(`${result.collection.insertedCount} added`);
    }
    if (result.collection.updatedCount > 0) {
      stats.push(`${result.collection.updatedCount} updated`);
    }
    if (result.collection.skippedDuplicateCount > 0) {
      stats.push(`${result.collection.skippedDuplicateCount} duplicates skipped`);
    }
    useNotificationStore.getState().push({
      kind: "success",
      title: "Upload finished",
      body: `${fileName} → ${result.collection.displayName}${
        stats.length > 0 ? ` (${stats.join(", ")})` : ""
      }`,
      link: "/documents",
    });
    set({ isProcessing: false });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    processNext();
  };

  const finishHardError = (id: string, fileName: string, message: string) => {
    patchItem(id, { status: "error", errorMessage: message });
    useNotificationStore.getState().push({
      kind: "error",
      title: "Upload failed",
      body: `${fileName}: ${message}`,
      link: "/documents",
    });
    set({ isProcessing: false });
    processNext();
  };

  /** Shared 429/transient handling; returns true when the error was handled. */
  const handleRetryableError = (id: string, error: unknown): boolean => {
    if (isAxiosError<UploadErrorBody>(error) && error.response?.status === 429) {
      const body = error.response.data;
      const retryAfterMs = typeof body?.retryAfterMs === "number" ? body.retryAfterMs : 60_000;
      const retryAt = Date.now() + retryAfterMs + RATE_LIMIT_BUFFER_MS;
      patchItem(id, { status: "waiting", retryAt });
      set({ isProcessing: false });
      scheduleRetry(id, retryAt - Date.now());
      return true;
    }
    const current = get().items.find((entry) => entry.id === id);
    const attempts = current?.attempts ?? 0;
    if (attempts < MAX_TRANSIENT_RETRIES) {
      const retryAt = Date.now() + TRANSIENT_RETRY_DELAY_MS;
      patchItem(id, { status: "waiting", retryAt, attempts: attempts + 1 });
      set({ isProcessing: false });
      scheduleRetry(id, TRANSIENT_RETRY_DELAY_MS);
      return true;
    }
    return false;
  };

  const runUpload = async (id: string) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item) {
      set({ isProcessing: false });
      processNext();
      return;
    }

    if (!item.file) {
      // Rehydrated after a reload without its File — cannot be uploaded.
      patchItem(id, { status: "error", errorMessage: RELOAD_LOST_MESSAGE });
      set({ isProcessing: false });
      processNext();
      return;
    }

    patchItem(id, { status: "uploading", retryAt: null, errorMessage: null });

    try {
      const response = await planUpload(item.file, item.instruction);
      if (response.status === "applied") {
        finishSuccess(id, item.fileName, response);
        return;
      }
      // Every upload stages server-side and parks the queue until the user
      // approves it (or picks merge / create-new / skip) on the Documents page.
      patchItem(id, {
        status: "needs-decision",
        pending: {
          pendingId: response.pendingId,
          expiresAt: response.expiresAt,
          plan: response.plan,
          sqlSummary: response.sqlSummary,
          similarityNote: response.similarityNote,
          similarCollections: response.similarCollections,
          preview: response.preview,
        },
      });
      useNotificationStore.getState().push({
        kind: "info",
        title: "Upload waiting for approval",
        body: `${item.fileName} is parsed — review what will be created before it's saved.`,
        link: "/documents",
      });
      set({ isProcessing: false });
    } catch (error) {
      if (isAxiosError<UploadErrorBody>(error) && error.response) {
        const status = error.response.status;
        if (status === 415 || status === 413 || status === 422) {
          // Hard client errors: this file will never succeed — mark and move on.
          finishHardError(id, item.fileName, hardErrorMessage(error.response.data?.error));
          return;
        }
      }
      if (handleRetryableError(id, error)) return;
      finishHardError(
        id,
        item.fileName,
        "Something went wrong processing this file, even after a retry.",
      );
    }
  };

  const runApply = async (id: string) => {
    const item = get().items.find((entry) => entry.id === id);
    if (!item || !item.pending || !item.decision) {
      set({ isProcessing: false });
      processNext();
      return;
    }

    patchItem(id, { status: "uploading", retryAt: null, errorMessage: null });
    set({ isProcessing: true });

    try {
      const result = await applyUpload(item.pending.pendingId, item.decision);
      finishSuccess(id, item.fileName, result);
    } catch (error) {
      if (isAxiosError<UploadErrorBody>(error) && error.response) {
        const status = error.response.status;
        const code = error.response.data?.error;

        if (status === 404 && code === "pending_upload_not_found") {
          // The staged plan expired server-side. The File is still in memory,
          // so send the item back through planning for a fresh preview.
          patchItem(id, {
            status: "queued",
            pending: null,
            decision: null,
            retryAt: null,
            errorMessage: null,
          });
          set({ isProcessing: false });
          processNext();
          return;
        }

        if (status === 409 && code === "collection_limit_reached") {
          finishHardError(id, item.fileName, "Your Free plan is limited to 20 collections. Remove a collection or upgrade to continue.");
          return;
        }

        if (status === 409 && code === "target_collection_not_found") {
          patchItem(id, {
            status: "needs-decision",
            decision: null,
            errorMessage:
              "That collection no longer exists — pick another option for this file.",
          });
          set({ isProcessing: false });
          return;
        }
      }
      if (handleRetryableError(id, error)) return;
      finishHardError(
        id,
        item.fileName,
        "Something went wrong applying this upload, even after a retry.",
      );
    }
  };

  /**
   * Strictly sequential FIFO loop. Safe to call from anywhere, any number of
   * times: it no-ops if an upload is in flight, an item is waiting on a
   * scheduled retry, or an item is parked on a user decision (that item owns
   * the pipeline to preserve FIFO order and respect the upload rate limit).
   */
  const processNext = () => {
    const state = get();
    if (state.isProcessing) return;
    if (
      state.items.some(
        (item) => item.status === "waiting" || item.status === "needs-decision",
      )
    ) {
      return;
    }
    const next = state.items.find((item) => item.status === "queued");
    if (!next) return;
    set({ isProcessing: true });
    void runUpload(next.id);
  };

  return {
    items: [],
    isProcessing: false,

    enqueue: (files, instruction) => {
      if (files.length === 0) return;
      const now = Date.now();
      const newItems: QueueItem[] = files.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        file,
        instruction,
        status: "queued",
        retryAt: null,
        result: null,
        pending: null,
        decision: null,
        errorMessage: null,
        attempts: 0,
        addedAt: now,
      }));
      set((state) => ({ items: [...state.items, ...newItems] }));
      processNext();
    },

    resolveDecision: (id, decision) => {
      const item = get().items.find((entry) => entry.id === id);
      if (!item || item.status !== "needs-decision" || !item.pending) return;
      patchItem(id, { decision });
      void runApply(id);
    },

    skipDecision: (id) => {
      const item = get().items.find((entry) => entry.id === id);
      if (!item || item.status !== "needs-decision") return;
      if (item.pending) {
        cancelUpload(item.pending.pendingId).catch(() => {
          // Server TTL cleans up anything we failed to cancel.
        });
      }
      patchItem(id, { status: "canceled", pending: null, decision: null });
      processNext();
    },

    remove: (id) => {
      const item = get().items.find((entry) => entry.id === id);
      if (!item || item.status === "uploading") return;
      const timer = retryTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        retryTimers.delete(id);
      }
      if (item.pending) {
        cancelUpload(item.pending.pendingId).catch(() => {
          // Server TTL cleans up anything we failed to cancel.
        });
      }
      set((state) => ({ items: state.items.filter((entry) => entry.id !== id) }));
      processNext();
    },

    clearFinished: () => {
      set((state) => ({
        items: state.items.filter(
          (item) =>
            item.status !== "done" && item.status !== "error" && item.status !== "canceled",
        ),
      }));
    },
  };
    },
    {
      name: "bijustubu-upload-queue",
      storage: createJSONStorage(() => sessionStorage),
      // Functions and isProcessing are transient; only the item list persists
      // (minus File objects, which aren't serializable).
      partialize: (state) => ({
        items: state.items.map((item) => ({ ...item, file: null })),
      }),
      merge: (persisted, current) => {
        const stored = persisted as { items?: QueueItem[] } | undefined;
        return { ...current, items: sanitizeRehydratedItems(stored?.items ?? []) };
      },
    },
  ),
);
