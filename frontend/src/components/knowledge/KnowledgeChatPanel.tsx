import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BubbleChatIcon,
  Delete02Icon,
  Loading03Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { clearKnowledgeChat, getKnowledgeChat } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { useKnowledgeChatJobStore } from "@/store/knowledgeChatJobStore";

interface KnowledgeChatPanelProps {
  /** Whether the user has any documents — drives the empty-state copy. */
  hasDocuments: boolean;
  /** Opens the document viewer for a cited source (matched by name). */
  onOpenSource?: (name: string) => void;
}

/**
 * Inline RAG chat over the user's knowledge base. The request lifecycle lives
 * in a global job store, so pending state survives route changes and reloads.
 */
export function KnowledgeChatPanel({ hasDocuments, onOpenSource }: KnowledgeChatPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);

  const job = useKnowledgeChatJobStore((state) => state.job);
  const send = useKnowledgeChatJobStore((state) => state.send);
  const retry = useKnowledgeChatJobStore((state) => state.retry);
  const dismiss = useKnowledgeChatJobStore((state) => state.dismiss);
  const complete = useKnowledgeChatJobStore((state) => state.complete);

  const chatQuery = useQuery({
    queryKey: ["knowledge", "chat"],
    queryFn: getKnowledgeChat,
  });
  const messages = chatQuery.data?.messages ?? [];
  const persistedAnswerExists = Boolean(
    job &&
      messages.some(
        (message) => message.role === "assistant" && message.requestId === job.id,
      ),
  );
  const visibleJob = persistedAnswerExists ? null : job;
  const jobActive = Boolean(visibleJob && visibleJob.status !== "error");

  useEffect(() => {
    if (job && persistedAnswerExists) complete(job.id);
  }, [complete, job, persistedAnswerExists]);

  useEffect(() => {
    if (visibleJob?.status !== "waiting" || visibleJob.retryAt === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [visibleJob?.status, visibleJob?.retryAt]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, visibleJob?.id, visibleJob?.status]);

  const clearMutation = useMutation({
    mutationFn: clearKnowledgeChat,
    onSuccess: () => {
      queryClient.setQueryData(["knowledge", "chat"], { messages: [] });
      dismiss();
    },
  });

  const retrySeconds =
    visibleJob?.status === "waiting" && visibleJob.retryAt !== null
      ? Math.max(0, Math.ceil((visibleJob.retryAt - now) / 1000))
      : null;

  function handleSend() {
    const message = draft.trim();
    if (!message || jobActive) return;
    if (send(message)) setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border-soft px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-ink">Ask your documents</h2>
          <p className="text-[11px] text-ink-muted">
            Answers are grounded only in your knowledge base.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-ink-muted"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || jobActive}
          >
            {clearMutation.isPending ? (
              <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
            )}
            Clear
          </Button>
        )}
      </div>

      <div
        ref={listRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-4",
          THIN_SCROLLBAR_CLASS,
        )}
      >
        {messages.length === 0 && !visibleJob && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
              <HugeiconsIcon icon={BubbleChatIcon} className="h-5 w-5" />
            </span>
            <p className="text-sm text-ink-muted">
              {hasDocuments
                ? "Ask anything about your uploaded documents."
                : "Upload documents first, then ask questions about them here."}
            </p>
          </div>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <div
              key={index}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-sidebar px-3.5 py-2 text-sm text-sidebar-ink"
            >
              {message.content}
            </div>
          ) : (
            <div key={index} className="flex max-w-[85%] flex-col gap-1 self-start">
              <div className="rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 text-sm text-ink">
                {message.content}
              </div>
              {message.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pl-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                    {message.sources.length > 1
                      ? `${message.sources.length} sources`
                      : "Source"}
                  </span>
                  {message.sources.map((source) => (
                    <button
                      key={source}
                      type="button"
                      title={`Open ${source}`}
                      onClick={() => onOpenSource?.(source)}
                      className="inline-flex min-w-0 max-w-full items-center rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/20"
                    >
                      <span className="truncate">{source}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {visibleJob && (
          <>
            <div className="max-w-[85%] animate-fade-in self-end rounded-2xl rounded-br-md bg-sidebar/80 px-3.5 py-2 text-sm text-sidebar-ink">
              {visibleJob.message}
            </div>
            {visibleJob.status === "error" ? (
              <div className="flex max-w-[85%] animate-fade-in flex-col gap-2 self-start rounded-2xl rounded-bl-md bg-rose-50 px-3.5 py-2 text-sm text-rose-700">
                <span>{visibleJob.error}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="text-xs font-semibold hover:underline"
                  >
                    Retry
                  </button>
                  <button type="button" onClick={dismiss} className="text-xs hover:underline">
                    Dismiss
                  </button>
                </span>
              </div>
            ) : (
              <div className="flex max-w-[85%] animate-fade-in items-center gap-2 self-start rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 text-sm text-ink-muted">
                <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
                {retrySeconds !== null
                  ? `Retrying in ${retrySeconds}s…`
                  : visibleJob.status === "queued"
                    ? "Queued…"
                    : "Searching your documents…"}
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSend();
            }}
            placeholder="Ask about your documents…"
            disabled={jobActive}
            className="h-10 w-full rounded-full border border-border-soft bg-surface-muted px-4 text-sm text-ink transition-colors placeholder:text-ink-muted/70 focus:border-accent-blue/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-blue/30 disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={jobActive || !draft.trim()}
            title="Send"
            className="shrink-0"
          >
            {jobActive ? (
              <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
            ) : (
              <HugeiconsIcon icon={SentIcon} className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
