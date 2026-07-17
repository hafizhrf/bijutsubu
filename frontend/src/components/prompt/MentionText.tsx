import { Fragment } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

// Keep in sync with CollectionMentionInput's MENTION_TOKEN_RE.
const MENTION_TOKEN_RE = /\{([a-zA-Z0-9_]+)(\.[a-zA-Z0-9_ \-/()]+)?\}/g;

interface MentionTextProps {
  text: string;
  /** Chip colors — override where the default blue clashes (e.g. dark bubbles). */
  chipClassName?: string;
}

/**
 * Read-only rendering of prompt text: {collection} / {collection.field}
 * mention tokens become styled, clickable chips (→ the collection page),
 * everything else stays plain text. Used in chat bubbles and prompt echoes.
 */
export function MentionText({ text, chipClassName }: MentionTextProps) {
  const navigate = useNavigate();
  const parts: ReactNode[] = [];
  let cursor = 0;

  MENTION_TOKEN_RE.lastIndex = 0;
  for (let match = MENTION_TOKEN_RE.exec(text); match; match = MENTION_TOKEN_RE.exec(text)) {
    const start = match.index;
    if (start > cursor) parts.push(<Fragment key={cursor}>{text.slice(cursor, start)}</Fragment>);
    const collection = match[1];
    parts.push(
      <button
        key={start}
        type="button"
        title={`Open ${collection}`}
        onClick={() => navigate(`/collections?c=${encodeURIComponent(collection)}`)}
        className={cn(
          "rounded px-0.5 font-medium transition-colors",
          chipClassName ?? "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20",
        )}
      >
        {match[0]}
      </button>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push(<Fragment key={cursor}>{text.slice(cursor)}</Fragment>);

  return <>{parts}</>;
}
