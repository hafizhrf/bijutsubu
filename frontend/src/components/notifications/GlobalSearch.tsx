import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardCircleIcon,
  Database01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { getCollections } from "@/api/collections";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SavedDashboardSummary } from "@/types/dashboard";

const DEBOUNCE_MS = 200;
const MAX_PER_GROUP = 5;

interface SearchResult {
  key: string;
  group: "Collections" | "Dashboards";
  label: string;
  sublabel: string | null;
  to: string;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border-soft bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-muted">
      {children}
    </kbd>
  );
}

/**
 * Spotlight-style command palette: the top-bar trigger is just a button;
 * the real search lives in a centered modal (portal) opened by click or
 * Cmd/Ctrl+K. State lives inside the palette so each open starts fresh.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search collections and dashboards"
        className={cn(
          "hidden h-11 w-64 items-center gap-2.5 rounded-full border border-border-soft bg-surface px-4 text-sm text-ink-muted transition-[color,border-color,box-shadow,opacity,scale] duration-200 ease-out hover:border-accent-blue/40 hover:text-ink sm:flex",
          // While the palette is up the trigger gets "sucked away": it fades
          // and shrinks slightly, then springs back when the palette closes.
          open && "pointer-events-none scale-90 opacity-0",
        )}
      >
        <HugeiconsIcon icon={Search01Icon} size={16} className="shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <span className="flex items-center gap-1">
          <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const needle = debouncedQuery.trim().toLowerCase();

  // Focus the input on mount (autoFocus is flagged by a11y lint) and lock
  // body scroll while the palette is up.
  useEffect(() => {
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: getCollections,
    enabled: needle.length > 0,
  });

  const dashboardsQuery = useQuery({
    queryKey: ["dashboards", "saved"],
    queryFn: async () => {
      const res = await api.get<{ dashboards: SavedDashboardSummary[] }>("/dashboard/saved");
      return res.data.dashboards;
    },
    enabled: needle.length > 0,
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!needle) return [];
    const collections = (collectionsQuery.data ?? [])
      .filter(
        (collection) =>
          collection.name.toLowerCase().includes(needle) ||
          collection.displayName.toLowerCase().includes(needle),
      )
      .slice(0, MAX_PER_GROUP)
      .map<SearchResult>((collection) => ({
        key: `collection-${collection.name}`,
        group: "Collections",
        label: collection.displayName,
        sublabel: `${collection.rowCount} rows`,
        to: `/collections?c=${encodeURIComponent(collection.name)}`,
      }));
    const dashboards = (dashboardsQuery.data ?? [])
      .filter(
        (dashboard) =>
          dashboard.title.toLowerCase().includes(needle) ||
          dashboard.prompt.toLowerCase().includes(needle),
      )
      .slice(0, MAX_PER_GROUP)
      .map<SearchResult>((dashboard) => ({
        key: `dashboard-${dashboard._id}`,
        group: "Dashboards",
        label: dashboard.title,
        sublabel: dashboard.prompt,
        to: `/dashboard/${encodeURIComponent(dashboard._id)}`,
      }));
    return [...collections, ...dashboards];
  }, [needle, collectionsQuery.data, dashboardsQuery.data]);

  // Keep the highlighted row valid as the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [needle, results.length]);

  function pick(result: SearchResult) {
    onClose();
    navigate(result.to);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = results[activeIndex];
      if (active) pick(active);
    }
  }

  const isLoading = collectionsQuery.isLoading || dashboardsQuery.isLoading;
  const groups: SearchResult["group"][] = ["Collections", "Dashboards"];

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/30 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="absolute inset-x-4 top-[16vh] mx-auto max-w-xl animate-pop-in overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-[0_24px_80px_-16px_rgba(11,11,15,0.45)]"
      >
        <div className="flex items-center gap-3 border-b border-border-soft px-5">
          <HugeiconsIcon icon={Search01Icon} size={18} className="shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={needle.length > 0}
            aria-label="Search collections and dashboards"
            placeholder="Search collections and dashboards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {needle.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              Type to search your collections and dashboards.
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              {isLoading ? "Searching…" : "No results"}
            </p>
          ) : (
            groups.map((group) => {
              const groupResults = results.filter((result) => result.group === group);
              if (groupResults.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    {group}
                  </p>
                  {groupResults.map((result) => {
                    const flatIndex = results.indexOf(result);
                    return (
                      <button
                        key={result.key}
                        type="button"
                        onClick={() => pick(result)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-100",
                          flatIndex === activeIndex && "bg-surface-muted",
                        )}
                      >
                        <HugeiconsIcon
                          icon={group === "Collections" ? Database01Icon : DashboardCircleIcon}
                          size={16}
                          className="shrink-0 text-ink-muted"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{result.label}</span>
                          {result.sublabel && (
                            <span className="block truncate text-xs text-ink-muted">
                              {result.sublabel}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border-soft px-4 py-2.5 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> Open</span>
          <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> Close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
