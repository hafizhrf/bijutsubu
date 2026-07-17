import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";

export interface SelectionEntry {
  id: string;
  label: string;
}

interface SelectionTrackerProps {
  entries: SelectionEntry[];
  deleting: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDeleteAll: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Google-Drive-style floating tray, fixed to the viewport (defaults to
 * bottom-center, clear of the grid's pagination). Drag the header to move it
 * anywhere it isn't in the way. Shows everything currently selected —
 * selection survives pagination — with per-row remove, clear all, and
 * bulk-delete.
 */
export function SelectionTracker({
  entries,
  deleting,
  onRemove,
  onClear,
  onDeleteAll,
}: SelectionTrackerProps) {
  const [expanded, setExpanded] = useState(true);
  // null → default docked position; set once the user drags the tray.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);

  if (entries.length === 0) return null;

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Buttons inside the header keep their own behavior.
    if ((event.target as HTMLElement).closest("button")) return;
    const tray = trayRef.current;
    if (!tray) return;
    const rect = tray.getBoundingClientRect();
    dragOffset.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const offset = dragOffset.current;
    const tray = trayRef.current;
    if (!offset || !tray) return;
    const rect = tray.getBoundingClientRect();
    setPosition({
      x: clamp(event.clientX - offset.dx, 8, window.innerWidth - rect.width - 8),
      y: clamp(event.clientY - offset.dy, 8, window.innerHeight - rect.height - 8),
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Portaled to <body>: ancestors with transforms/overflow (animated cards)
  // would otherwise re-anchor position:fixed and clip the tray.
  return createPortal(
    <div
      className={cn(
        "fixed z-40",
        position === null && "pointer-events-none inset-x-0 bottom-5 flex justify-center px-4",
      )}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div
        ref={trayRef}
        className="pointer-events-auto w-[28rem] max-w-[calc(100vw-2rem)] animate-fade-in-up overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-card"
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="flex touch-none items-center gap-2 px-3 py-3"
        >
          <span
            title="Drag to move"
            className="flex shrink-0 cursor-grab items-center text-ink-muted active:cursor-grabbing"
          >
            <HugeiconsIcon icon={DragDropVerticalIcon} className="h-4 w-4" />
          </span>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50"
            title={expanded ? "Collapse selection" : "Expand selection"}
          >
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar px-1.5 text-[11px] font-semibold tabular-nums text-sidebar-ink">
              {entries.length}
            </span>
            <span className="truncate text-sm font-medium text-ink">
              row{entries.length === 1 ? "" : "s"} selected
            </span>
            {expanded ? (
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            ) : (
              <HugeiconsIcon icon={ArrowUp01Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={onClear}
            disabled={deleting}
          >
            Clear
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={onDeleteAll}
            disabled={deleting}
          >
            {deleting ? (
              <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3" />
            )}
            Delete
          </Button>
        </div>

        {expanded && (
          <ul
            className={cn(
              "max-h-48 overflow-y-auto border-t border-border-soft py-1",
              THIN_SCROLLBAR_CLASS,
            )}
          >
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="group/item flex items-center gap-2 px-4 py-1.5 transition-colors hover:bg-surface-muted/60"
              >
                <span className="shrink-0 font-mono text-[10px] text-ink-muted">
                  …{entry.id.slice(-6)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink" title={entry.label}>
                  {entry.label}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  disabled={deleting}
                  title="Remove from selection"
                  className="rounded-full p-1 text-ink-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover/item:opacity-100"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
