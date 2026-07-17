import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CollectionMentionInput } from "@/components/prompt/CollectionMentionInput";
import { MentionText } from "@/components/prompt/MentionText";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { useSettingsStore } from "@/store/settingsStore";
import type { DashboardChatMessage } from "@/types/dashboard";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Clock01Icon,
  Loading03Icon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons";

export interface PromptDockChat {
  messages: DashboardChatMessage[];
  /** Optimistic user bubble while a refine request is in flight. */
  pendingPrompt?: string | null;
  /** Assistant-side "working…" bubble text shown under the pending prompt. */
  pendingLabel?: string;
}

interface PromptDockProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  submitLabel?: string;
  /** When set, the chat history expands above the bar while the input is focused. */
  chat?: PromptDockChat;
  /** Recent prompts (deduped, newest first) offered for one-click reuse. */
  history?: string[];
}

/**
 * Chat-style prompt bar floating at the bottom of genUI pages. Centered
 * within the content area (offset past the sidebar rail) and width-capped so
 * it never collides with the upload QueueIndicator pill in the bottom-right
 * corner. Pages rendering it should end with a ~h-24 spacer.
 */
export function PromptDock({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  busy = false,
  busyLabel,
  error,
  submitLabel = "Generate",
  chat,
  history,
}: PromptDockProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const sidebarPinned = useSettingsStore((state) => state.sidebarPinned);

  // Focus-driven: the history shows while the prompt field has focus, and
  // stays up during an in-flight edit so its progress bubble remains visible.
  const chatVisible = Boolean(chat) && (inputFocused || Boolean(chat?.pendingPrompt));

  useEffect(() => {
    if (!chatVisible) return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatVisible, chat?.messages.length, chat?.pendingPrompt]);

  // Portal to <body>: the page content wrapper animates with a transform,
  // which would otherwise turn position:fixed into "fixed to the wrapper" —
  // the dock must anchor to the viewport like the upload pill does.
  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 right-0 z-40 flex justify-center px-4 transition-[left] duration-200",
        sidebarPinned ? "left-0 md:left-60" : "left-0 md:left-20",
      )}
    >
      <div
        className="pointer-events-auto relative w-full max-w-2xl sm:max-w-[min(42rem,calc(100vw-27rem))]"
        onFocusCapture={() => setInputFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setInputFocused(false);
            setHistoryOpen(false);
          }
        }}
      >
        {historyOpen && history && history.length > 0 && (
          <div
            onPointerDown={(event) => event.preventDefault()}
            className="absolute bottom-full left-0 right-0 mx-auto mb-2 flex max-h-72 w-full max-w-xl origin-bottom animate-pop-in flex-col overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-2xl shadow-black/15"
          >
            <div className="border-b border-border-soft px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">Recent prompts</p>
              <p className="text-[11px] text-ink-muted">Click one to reuse it.</p>
            </div>
            <ul className={cn("overflow-y-auto py-1.5", THIN_SCROLLBAR_CLASS)}>
              {history.slice(0, 8).map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => {
                      onValueChange(prompt);
                      setHistoryOpen(false);
                    }}
                    className="w-full cursor-pointer px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-muted"
                  >
                    <span className="line-clamp-2">{prompt}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {chatVisible && chat && (
          <div
            // Pressing inside the panel must not steal focus from the input —
            // that would blur-close the panel mid-interaction (e.g. scrolling).
            onPointerDown={(event) => event.preventDefault()}
            className="absolute bottom-full left-0 right-0 mx-auto mb-2 flex max-h-[min(24rem,calc(100vh-11rem))] w-full max-w-xl origin-bottom animate-pop-in flex-col overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-2xl shadow-black/15"
          >
            <div className="border-b border-border-soft px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">Chat</p>
              <p className="text-[11px] text-ink-muted">
                Every prompt edit is applied and recorded here.
              </p>
            </div>
            <div
              ref={messageListRef}
              className={cn("flex flex-col gap-2.5 overflow-y-auto px-4 py-4", THIN_SCROLLBAR_CLASS)}
            >
              {chat.messages.length === 0 && !chat.pendingPrompt && (
                <p className="py-6 text-center text-xs text-ink-muted">
                  No messages yet — describe a change below to start.
                </p>
              )}
              {chat.messages.map((message, index) =>
                message.role === "user" ? (
                  <div
                    key={index}
                    className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-sidebar px-3.5 py-2 text-sm text-sidebar-ink"
                  >
                    <MentionText
                      text={message.content}
                      chipClassName="bg-sidebar-ink/15 text-sidebar-ink hover:bg-sidebar-ink/25"
                    />
                  </div>
                ) : (
                  <div
                    key={index}
                    className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 text-sm text-ink"
                  >
                    <MentionText text={message.content} />
                  </div>
                ),
              )}
              {chat.pendingPrompt && (
                <>
                  <div className="max-w-[85%] animate-fade-in self-end rounded-2xl rounded-br-md bg-sidebar/80 px-3.5 py-2 text-sm text-sidebar-ink">
                    <MentionText
                      text={chat.pendingPrompt}
                      chipClassName="bg-sidebar-ink/15 text-sidebar-ink hover:bg-sidebar-ink/25"
                    />
                  </div>
                  <div className="flex max-w-[85%] animate-fade-in items-center gap-2 self-start rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 text-sm text-ink-muted">
                    <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
                    {chat.pendingLabel ?? "Working…"}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {(error || (busy && busyLabel)) && (
          <div
            className={cn(
              "mx-3 mb-1.5 flex items-center gap-2 rounded-t-xl px-4 py-2 text-xs shadow-card animate-fade-in",
              error ? "bg-rose-50 text-rose-700" : "bg-surface text-ink-muted",
            )}
          >
            {busy && busyLabel && <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" />}
            {error ?? busyLabel}
          </div>
        )}
        <div className="flex animate-dock-glow items-center gap-2 rounded-[1.75rem] border border-border-soft bg-surface/95 p-2 backdrop-blur">
          {history && history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label="Recent prompts"
              title="Recent prompts"
              aria-expanded={historyOpen}
              className={cn(
                "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink",
                historyOpen && "bg-surface-muted text-ink",
              )}
            >
              <HugeiconsIcon icon={Clock01Icon} className="h-4 w-4" />
            </button>
          )}
          <CollectionMentionInput
            value={value}
            onValueChange={onValueChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
            dropUp
            disabled={busy}
            className="border-transparent bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
          />
          <Button onClick={onSubmit} disabled={busy || !value.trim()} className="shrink-0">
            {busy ? <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" /> : <HugeiconsIcon icon={MagicWand01Icon} className="h-4 w-4" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
