import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getCollections } from "@/api/collections";
import type { CollectionField, MetaCollection } from "@/types/collections";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { fieldTypeDotClass } from "@/components/datagrid/FieldList";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

/**
 * Field mention right before the caret: "{sales.", "{sales.reg", and also
 * "{sales}." (the closed form a collection pick leaves behind — typing "."
 * right after it upgrades the mention to collection.field).
 */
const FIELD_MENTION_RE = /\{([a-zA-Z0-9_]+)\}?\.([a-zA-Z0-9_ \-/()]*)$/;
/** Partial collection mention right before the caret: "{", "{prod", … */
const COLLECTION_MENTION_RE = /\{([a-zA-Z0-9_]*)$/;
/** Completed mention tokens anywhere in the value: "{sales}" or "{sales.region}". */
const MENTION_TOKEN_RE = /\{([a-zA-Z0-9_]+)(\.[a-zA-Z0-9_ \-/()]+)?\}/g;

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

type MentionState =
  | { kind: "collection"; query: string }
  | { kind: "field"; collectionName: string; query: string };

interface CollectionMentionInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Renders a textarea instead of a single-line input. */
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  /** Extra classes for the outer wrapper (e.g. flex-1 in a flex column). */
  containerClassName?: string;
  /** Open the suggestion list above the field (for bottom-docked inputs). */
  dropUp?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  /**
   * Fired on Enter when no suggestion list is open (Ctrl/Cmd+Enter for
   * multiline). Leave unset inside a <form> to keep native submit behavior.
   */
  onSubmit?: () => void;
}

/**
 * The value split into plain text and styled mention chips. Rendered in an
 * overlay that sits pixel-aligned on top of the (transparent-text) field, so
 * chips must not change glyph metrics — color/background only, no padding.
 */
function HighlightedValue({
  value,
  knownNames,
  onOpenCollection,
  onRemoveToken,
}: {
  value: string;
  knownNames: Set<string>;
  onOpenCollection: (name: string) => void;
  onRemoveToken: (start: number, end: number) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  MENTION_TOKEN_RE.lastIndex = 0;
  for (let match = MENTION_TOKEN_RE.exec(value); match; match = MENTION_TOKEN_RE.exec(value)) {
    if (match.index > last) parts.push(value.slice(last, match.index));
    const name = match[1];
    const known = knownNames.has(name.toLowerCase());
    const start = match.index;
    const end = match.index + match[0].length;
    parts.push(
      <span
        key={key++}
        className={cn(
          // relative + group so the floating remove button can anchor to the
          // chip without adding padding (the overlay must keep glyph metrics
          // identical to the field's).
          "group/chip pointer-events-auto relative rounded bg-accent-blue/10 text-accent-blue",
          known && "cursor-pointer transition-colors hover:bg-accent-blue/25",
        )}
        title={known ? `Open ${name} in Collections` : undefined}
        // preventDefault keeps focus in the field so the click doesn't blur it first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={known ? () => onOpenCollection(name) : undefined}
      >
        {match[0]}
        <button
          type="button"
          aria-label={`Remove ${match[0]} from prompt`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveToken(start, end);
          }}
          className="absolute left-full top-1/2 z-10 ml-0.5 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-border-soft bg-surface text-ink-muted opacity-0 shadow-sm transition-opacity duration-100 hover:bg-rose-100 hover:text-rose-600 group-hover/chip:opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-2.5 w-2.5" />
        </button>
      </span>,
    );
    last = end;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

function detectMention(textBeforeCaret: string): MentionState | null {
  const fieldMatch = textBeforeCaret.match(FIELD_MENTION_RE);
  if (fieldMatch) {
    return { kind: "field", collectionName: fieldMatch[1], query: fieldMatch[2] };
  }
  const collectionMatch = textBeforeCaret.match(COLLECTION_MENTION_RE);
  if (collectionMatch) {
    return { kind: "collection", query: collectionMatch[1] };
  }
  return null;
}

/**
 * Prompt input with data-aware autocomplete: typing "{" opens a dropdown of
 * the user's collections, and typing "." after a collection (either while the
 * mention is still open or right after a picked "{name}") opens that
 * collection's fields — producing "{collection}" or "{collection.field}".
 * Used by the genUI dashboard prompt, the relations prompt, and custom tables.
 */
export function CollectionMentionInput({
  value,
  onValueChange,
  multiline = false,
  placeholder,
  className,
  containerClassName,
  dropUp = false,
  disabled,
  autoFocus,
  id,
  onSubmit,
}: CollectionMentionInputProps) {
  const navigate = useNavigate();
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: getCollections });
  const inputRef = useRef<FieldElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const knownNames = useMemo(
    () => new Set((collectionsQuery.data ?? []).map((c) => c.name.toLowerCase())),
    [collectionsQuery.data],
  );

  // The overlay must sit pixel-perfect on the field's text, so its box
  // metrics are copied from the field's computed style — callers are free to
  // override padding (e.g. pl-11 for a leading icon) without breaking it.
  useLayoutEffect(() => {
    const field = inputRef.current;
    const overlay = overlayRef.current;
    if (!field || !overlay) return;
    const cs = getComputedStyle(field);
    overlay.style.paddingLeft = cs.paddingLeft;
    overlay.style.paddingRight = cs.paddingRight;
    overlay.style.paddingTop = cs.paddingTop;
    overlay.style.paddingBottom = cs.paddingBottom;
    overlay.style.borderRadius = cs.borderRadius;
    overlay.style.fontSize = cs.fontSize;
    overlay.style.lineHeight = cs.lineHeight;
    overlay.style.fontFamily = cs.fontFamily;
    overlay.style.letterSpacing = cs.letterSpacing;
  }, [className, multiline]);

  /** Keeps the highlight overlay glued to the field's scroll position. */
  function syncOverlayScroll(event: React.UIEvent<FieldElement>) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.scrollTop = event.currentTarget.scrollTop;
    overlay.scrollLeft = event.currentTarget.scrollLeft;
  }

  /** Deletes a mention token (chip × button), collapsing a doubled space. */
  function removeToken(start: number, end: number) {
    const from = start;
    let to = end;
    if (value[from - 1] === " " && value[to] === " ") to += 1;
    onValueChange(value.slice(0, from) + value.slice(to));
    setMention(null);
    const el = inputRef.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from, from);
    });
  }
  const [mention, setMention] = useState<MentionState | null>(null);
  const [highlight, setHighlight] = useState(0);

  const collectionOptions = useMemo<MetaCollection[]>(() => {
    if (mention?.kind !== "collection") return [];
    const query = mention.query.toLowerCase();
    return (collectionsQuery.data ?? [])
      .filter(
        (collection) =>
          collection.name.toLowerCase().includes(query) ||
          collection.displayName.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [mention, collectionsQuery.data]);

  const fieldMentionCollection = useMemo<MetaCollection | null>(() => {
    if (mention?.kind !== "field") return null;
    const name = mention.collectionName.toLowerCase();
    return (
      (collectionsQuery.data ?? []).find(
        (collection) => collection.name.toLowerCase() === name,
      ) ?? null
    );
  }, [mention, collectionsQuery.data]);

  const fieldOptions = useMemo<CollectionField[]>(() => {
    if (mention?.kind !== "field" || !fieldMentionCollection) return [];
    const query = mention.query.toLowerCase();
    return fieldMentionCollection.fields
      .filter((field) => field.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [mention, fieldMentionCollection]);

  const optionCount = mention?.kind === "field" ? fieldOptions.length : collectionOptions.length;
  const open = mention !== null && optionCount > 0;

  function syncMention(el: FieldElement) {
    const caret = el.selectionStart ?? el.value.length;
    setMention(detectMention(el.value.slice(0, caret)));
    setHighlight(0);
  }

  /** Replaces the mention fragment before the caret with `inserted`. */
  function replaceMention(matchLength: number, inserted: string) {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const start = caret - matchLength;
    onValueChange(value.slice(0, start) + inserted + value.slice(caret));
    setMention(null);
    const nextCaret = start + inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function pickCollection(name: string) {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const match = value.slice(0, caret).match(COLLECTION_MENTION_RE);
    if (!match) return;
    replaceMention(match[0].length, `{${name}}`);
  }

  function pickField(fieldName: string) {
    const el = inputRef.current;
    if (!el || !fieldMentionCollection) return;
    const caret = el.selectionStart ?? value.length;
    const match = value.slice(0, caret).match(FIELD_MENTION_RE);
    if (!match) return;
    replaceMention(match[0].length, `{${fieldMentionCollection.name}.${fieldName}}`);
  }

  function pickHighlighted() {
    if (mention?.kind === "field") {
      const field = fieldOptions[highlight];
      if (field) pickField(field.name);
    } else {
      const collection = collectionOptions[highlight];
      if (collection) pickCollection(collection.name);
    }
  }

  function handleChange(event: React.ChangeEvent<FieldElement>) {
    onValueChange(event.target.value);
    syncMention(event.target);
  }

  function handleKeyDown(event: React.KeyboardEvent<FieldElement>) {
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((highlight + 1) % optionCount);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((highlight - 1 + optionCount) % optionCount);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickHighlighted();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && onSubmit) {
      if (!multiline) {
        event.preventDefault();
        onSubmit();
      } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onSubmit();
      }
    }
  }

  function handleKeyUp(event: React.KeyboardEvent<FieldElement>) {
    // Caret can move without a change event (arrows, Home/End, deletions).
    if (["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete"].includes(event.key)) {
      syncMention(event.currentTarget);
    }
  }

  const shared = {
    id,
    value,
    placeholder,
    disabled,
    autoFocus,
    // The field's own text is transparent — the overlay renders it (with
    // mention chips highlighted) in its place. The caret stays visible via
    // caretColor, and the placeholder keeps its own explicit color.
    className: cn("text-transparent", className),
    style: { caretColor: "var(--color-ink)" },
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
    onScroll: syncOverlayScroll,
    onClick: (event: React.MouseEvent<FieldElement>) => syncMention(event.currentTarget),
    onBlur: () => setMention(null),
  };

  return (
    <div className={cn("relative w-full", containerClassName)}>
      {multiline ? (
        <Textarea ref={inputRef as React.Ref<HTMLTextAreaElement>} {...shared} />
      ) : (
        <Input ref={inputRef as React.Ref<HTMLInputElement>} {...shared} />
      )}

      <div
        ref={overlayRef}
        aria-hidden="true"
        className={cn(
          // pointer-events-none lets typing/clicks reach the field below;
          // only mention chips opt back in to be clickable. Padding/typography
          // are synced from the field's computed style (see useLayoutEffect).
          "pointer-events-none absolute inset-0 z-[1] overflow-hidden border border-transparent text-ink",
          multiline ? "h-full whitespace-pre-wrap break-words" : "flex items-center whitespace-pre",
        )}
      >
        {multiline ? (
          <HighlightedValue
            value={value}
            knownNames={knownNames}
            onOpenCollection={(name) => navigate(`/collections?c=${encodeURIComponent(name)}`)}
            onRemoveToken={removeToken}
          />
        ) : (
          // Single wrapping span: raw text nodes would otherwise become
          // separate anonymous flex items and lose their spacing.
          <span className="whitespace-pre">
            <HighlightedValue
              value={value}
              knownNames={knownNames}
              onOpenCollection={(name) => navigate(`/collections?c=${encodeURIComponent(name)}`)}
              onRemoveToken={removeToken}
            />
          </span>
        )}
      </div>

      {open && (
        <div
          className={cn(
            "absolute left-0 z-50 max-h-52 w-full overflow-y-auto rounded-xl border border-border-soft bg-surface p-1 shadow-card animate-scale-in",
            dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
            THIN_SCROLLBAR_CLASS,
          )}
        >
          {mention?.kind === "field" && fieldMentionCollection ? (
            <>
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                Fields — {fieldMentionCollection.displayName}
              </p>
              {fieldOptions.map((field, index) => (
                <button
                  key={field.name}
                  type="button"
                  // preventDefault keeps focus in the input so onBlur doesn't kill the click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickField(field.name)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    index === highlight ? "bg-surface-muted text-ink" : "text-ink",
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fieldTypeDotClass(field.type))}
                  />
                  <span className="font-mono text-xs text-accent-blue">
                    {`{${fieldMentionCollection.name}.${field.name}}`}
                  </span>
                  <span className="min-w-0 flex-1" />
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {field.type}
                    {field.nullable ? "?" : ""}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                Collections — type "." after one for its fields
              </p>
              {collectionOptions.map((collection, index) => (
                <button
                  key={collection._id}
                  type="button"
                  // preventDefault keeps focus in the input so onBlur doesn't kill the click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickCollection(collection.name)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    index === highlight ? "bg-surface-muted text-ink" : "text-ink",
                  )}
                >
                  <span className="font-mono text-xs text-accent-blue">{`{${collection.name}}`}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    {collection.displayName}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
                    {collection.rowCount.toLocaleString()} rows
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
