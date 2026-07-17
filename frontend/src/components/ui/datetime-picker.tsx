import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CalendarDaysIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

/**
 * Blocks focus transfer on press. Every control inside the picker panel uses
 * this: the panel lives in a portal outside any Radix Dialog's focus scope,
 * and letting a control take focus there would make the dialog yank focus
 * back (breaking the interaction). Clicks still fire without focus.
 */
function keepFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/** Scrollable 00-NN column, the design-system replacement for native time selects. */
function TimeColumn({
  count,
  value,
  onPick,
}: {
  count: number;
  value: number;
  onPick: (next: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[data-selected="true"]');
    if (list && item) {
      list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={listRef}
      className={cn(
        "h-28 w-12 overflow-y-auto rounded-lg border border-border-soft bg-surface-muted",
        THIN_SCROLLBAR_CLASS,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          data-selected={i === value}
          onPointerDown={keepFocus}
          onClick={() => onPick(i)}
          className={cn(
            "block w-full py-1 text-center text-xs tabular-nums transition-colors",
            i === value
              ? "bg-sidebar font-semibold text-sidebar-ink"
              : "text-ink hover:bg-border-soft/60",
          )}
        >
          {String(i).padStart(2, "0")}
        </button>
      ))}
    </div>
  );
}

/**
 * Custom date+time picker matching the app design system (no native
 * <input type="date"> / browser datepicker anywhere).
 *
 * Value model is a plain string, timezone-free by construction:
 * "" (empty), "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm". Existing BSON dates
 * arrive as full ISO strings ("2015-07-04T00:00:00.000Z") — the leading
 * date/time components are read as-is, never shifted through local time.
 */
interface DateTimePickerProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Trigger styling — pass the form's input class for a uniform look. */
  className?: string;
  placeholder?: string;
  /** Open the panel immediately (inline cell editing). */
  autoOpen?: boolean;
  /** Called when the panel closes; committed=false means Escape/cancel. */
  onDismiss?: (committed: boolean) => void;
}

interface DateParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  hasTime: boolean;
}

const VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseValue(value: string): DateParts | null {
  const m = VALUE_RE.exec(value.trim());
  if (!m) return null;
  const parts: DateParts = {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] ? Number(m[4]) : 0,
    mm: m[5] ? Number(m[5]) : 0,
    hasTime: Boolean(m[4]) && !(Number(m[4]) === 0 && Number(m[5]) === 0),
  };
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;
  return parts;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toValue(parts: DateParts): string {
  const date = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
  return parts.hh === 0 && parts.mm === 0 ? date : `${date}T${pad(parts.hh)}:${pad(parts.mm)}`;
}

function formatLabel(parts: DateParts): string {
  const date = `${MONTHS[parts.m - 1].slice(0, 3)} ${parts.d}, ${parts.y}`;
  return parts.hasTime ? `${date} · ${pad(parts.hh)}:${pad(parts.mm)}` : date;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Monday-first weekday index (0-6) of a month's 1st day. */
function firstWeekday(y: number, m: number): number {
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}

const PANEL_WIDTH = 292;
const PANEL_MAX_HEIGHT = 396;

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled = false,
  className,
  placeholder = "Pick a date…",
  autoOpen = false,
  onDismiss,
}: DateTimePickerProps) {
  const selected = parseValue(value);
  const now = new Date();
  const [open, setOpen] = useState(autoOpen);
  const [view, setView] = useState(() => ({
    y: selected?.y ?? now.getFullYear(),
    m: selected?.m ?? now.getMonth() + 1,
  }));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const changedRef = useRef(false);

  function close(committed: boolean) {
    setOpen(false);
    setPanelStyle(null);
    onDismiss?.(committed);
  }

  // Position the portal panel against the trigger; above when the space
  // below is too tight. Recomputed only on open — scrolling closes instead.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - PANEL_WIDTH - 8);
    const below = window.innerHeight - rect.bottom >= PANEL_MAX_HEIGHT + 12;
    setPanelStyle(
      below
        ? { left, top: rect.bottom + 6, width: PANEL_WIDTH }
        : { left, bottom: window.innerHeight - rect.top + 6, width: PANEL_WIDTH },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(changedRef.current);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(false);
    }
    function onScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return;
      close(changedRef.current);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function emit(parts: DateParts) {
    changedRef.current = true;
    onChange(toValue(parts));
  }

  function pickDay(day: number) {
    emit({
      y: view.y,
      m: view.m,
      d: day,
      hh: selected?.hh ?? 0,
      mm: selected?.mm ?? 0,
      hasTime: Boolean(selected?.hasTime),
    });
  }

  function setTime(hh: number, mm: number) {
    const base = selected ?? {
      y: now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate(),
      hh: 0,
      mm: 0,
      hasTime: false,
    };
    emit({ ...base, hh, mm, hasTime: hh !== 0 || mm !== 0 });
  }

  function shiftMonth(delta: number) {
    setView((prev) => {
      const index = prev.y * 12 + (prev.m - 1) + delta;
      return { y: Math.floor(index / 12), m: (index % 12) + 1 };
    });
  }

  const blanks = firstWeekday(view.y, view.m);
  const dayCount = daysInMonth(view.y, view.m);
  const isViewingToday =
    view.y === now.getFullYear() && view.m === now.getMonth() + 1 ? now.getDate() : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(changedRef.current) : setOpen(true))}
        className={cn("flex items-center gap-2 text-left", className)}
      >
        <HugeiconsIcon icon={CalendarDaysIcon} className="h-4 w-4 shrink-0 text-ink-muted" />
        {selected ? (
          <span className="min-w-0 flex-1 truncate">{formatLabel(selected)}</span>
        ) : value.trim() !== "" ? (
          // Unparseable legacy value: show it raw; picking a date replaces it.
          <span className="min-w-0 flex-1 truncate text-ink-muted">{value}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink-muted/70">{placeholder}</span>
        )}
        {value.trim() !== "" && !disabled && (
          <span
            role="button"
            title="Clear"
            onClick={(event) => {
              event.stopPropagation();
              changedRef.current = true;
              onChange("");
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-border-soft hover:text-ink"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
          </span>
        )}
      </button>

      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            // data-floating-panel: parent dialogs must not treat clicks here
            // as outside-interactions (see dialog.tsx). pointer-events-auto:
            // modal dialogs disable pointer events on <body>, which this
            // panel is a direct child of.
            data-floating-panel=""
            className="pointer-events-auto fixed z-[120] origin-top animate-pop-in rounded-3xl border border-border-soft bg-surface p-4 shadow-2xl shadow-black/15"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                title="Previous month"
                onPointerDown={keepFocus}
                onClick={() => shiftMonth(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
              </button>
              <p className="text-sm font-semibold text-ink">
                {MONTHS[view.m - 1]} {view.y}
              </p>
              <button
                type="button"
                title="Next month"
                onPointerDown={keepFocus}
                onClick={() => shiftMonth(1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {WEEKDAYS.map((day) => (
                <span key={day} className="py-1 text-[10px] font-semibold uppercase text-ink-muted">
                  {day}
                </span>
              ))}
              {Array.from({ length: blanks }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {Array.from({ length: dayCount }, (_, i) => {
                const day = i + 1;
                const isSelected =
                  selected?.y === view.y && selected?.m === view.m && selected?.d === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onPointerDown={keepFocus}
                    onClick={() => pickDay(day)}
                    className={cn(
                      "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                      isSelected
                        ? "bg-sidebar font-semibold text-sidebar-ink"
                        : "text-ink hover:bg-surface-muted",
                      !isSelected && day === isViewingToday && "ring-1 ring-accent-blue/60",
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-border-soft pt-3">
              <span className="text-xs font-medium text-ink-muted">Time</span>
              <TimeColumn
                count={24}
                value={selected?.hh ?? 0}
                onPick={(hh) => setTime(hh, selected?.mm ?? 0)}
              />
              <span className="text-xs text-ink-muted">:</span>
              <TimeColumn
                count={60}
                value={selected?.mm ?? 0}
                onPick={(mm) => setTime(selected?.hh ?? 0, mm)}
              />
              <div className="ml-auto flex flex-col items-stretch gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onPointerDown={keepFocus}
                  onClick={() => {
                    setView({ y: now.getFullYear(), m: now.getMonth() + 1 });
                    emit({
                      y: now.getFullYear(),
                      m: now.getMonth() + 1,
                      d: now.getDate(),
                      hh: selected?.hh ?? 0,
                      mm: selected?.mm ?? 0,
                      hasTime: Boolean(selected?.hasTime),
                    });
                  }}
                >
                  Today
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onPointerDown={keepFocus}
                  onClick={() => close(true)}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
