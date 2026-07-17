import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  MagicWand01Icon,
  Xls01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";

const ROTATE_MS = 5500;

/* ---- Miniature feature previews — compacted versions of the real screens,
   built from the same design tokens so they read as the product itself. ---- */

function WindowFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-2xl bg-surface p-3.5 text-left shadow-2xl shadow-black/40",
        className,
      )}
    >
      <div className="mb-2.5 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
      </div>
      {children}
    </div>
  );
}

function GenUiMock() {
  const bars = [34, 58, 42, 72, 50, 88, 64];
  return (
    <WindowFrame>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          ["Revenue", "48.2M", "from-violet-500 to-purple-400"],
          ["Orders", "1,284", "from-sky-500 to-blue-400"],
          ["Growth", "+12%", "from-emerald-500 to-teal-400"],
        ].map(([label, value, gradient]) => (
          <div key={label} className={cn("rounded-xl bg-gradient-to-br p-2 text-white", gradient)}>
            <p className="text-[8px] font-medium opacity-80">{label}</p>
            <p className="text-xs font-bold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-14 items-end gap-1 rounded-xl bg-surface-muted p-2">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{ height: `${height}%` }}
            className={cn(
              "flex-1 rounded-sm",
              index === 5 ? "bg-accent-blue" : "bg-accent-blue/40",
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1.5">
        <HugeiconsIcon icon={MagicWand01Icon} className="h-3 w-3 shrink-0 text-ink-muted" />
        <span className="flex-1 truncate text-[9px] text-ink-muted">
          build a monthly sales dashboard from {"{sales_records}"}…
        </span>
        <span className="rounded-full bg-sidebar px-2 py-0.5 text-[8px] font-semibold text-sidebar-ink">
          Generate
        </span>
      </div>
    </WindowFrame>
  );
}

function DocToCollectionMock() {
  const rows = [
    ["Ergo Chair", "12", "8,400,000"],
    ["Desk Lamp", "40", "2,150,000"],
    ["Monitor 27\"", "8", "18,900,000"],
  ];
  return (
    <WindowFrame>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1.5">
          <HugeiconsIcon icon={Xls01Icon} className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-[9px] font-medium text-ink">sales_q2.xlsx</span>
        </span>
        <HugeiconsIcon icon={ArrowRight02Icon} className="h-3.5 w-3.5 text-ink-muted" />
        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[8px] font-semibold text-emerald-700">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-2.5 w-2.5" /> collection created
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-border-soft">
        <div className="grid grid-cols-[1.4fr_0.6fr_1fr] gap-2 border-b border-border-soft bg-surface-muted px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-wide text-ink-muted">
          <span>product</span>
          <span>qty</span>
          <span className="text-right">amount</span>
        </div>
        {rows.map(([product, qty, amount]) => (
          <div
            key={product}
            className="grid grid-cols-[1.4fr_0.6fr_1fr] gap-2 border-b border-border-soft px-2.5 py-1.5 text-[9px] text-ink last:border-0"
          >
            <span className="truncate">{product}</span>
            <span className="tabular-nums text-ink-muted">{qty}</span>
            <span className="text-right tabular-nums">{amount}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[8px] text-ink-muted">
        Types, fields, and relations decided automatically.
      </p>
    </WindowFrame>
  );
}

function EasyPromptingMock() {
  return (
    <WindowFrame>
      <div className="rounded-xl border border-border-soft px-2.5 py-2 text-[10px] leading-relaxed text-ink">
        total revenue per region from{" "}
        <span className="rounded bg-accent-blue/10 px-0.5 font-medium text-accent-blue">
          {"{sales_records}"}
        </span>{" "}
        joined with{" "}
        <span className="rounded bg-accent-blue/10 px-0.5 font-medium text-accent-blue">
          {"{contacts}"}
        </span>
        <span className="ml-0.5 inline-block h-3 w-px translate-y-0.5 bg-ink" />
      </div>
      <div className="mt-1.5 w-40 overflow-hidden rounded-xl border border-border-soft shadow-card">
        {["amount", "region", "order_date"].map((field, index) => (
          <div
            key={field}
            className={cn(
              "flex items-center justify-between px-2.5 py-1.5 text-[9px]",
              index === 1 ? "bg-surface-muted font-medium text-ink" : "text-ink-muted",
            )}
          >
            <span className="font-mono">.{field}</span>
            <span className="text-[7px] uppercase">{index === 2 ? "date" : index === 0 ? "num" : "str"}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[8px] text-ink-muted">
        Type {"{"} to mention collections, "." to pick fields — no query language.
      </p>
    </WindowFrame>
  );
}

function KnowledgeBaseMock() {
  return (
    <WindowFrame>
      <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-2.5 py-1.5">
        <HugeiconsIcon icon={File02Icon} className="h-3.5 w-3.5 text-accent-blue" />
        <span className="flex-1 truncate text-[9px] font-medium text-ink">
          privacy_policy_2026.pdf
        </span>
        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-2.5 w-2.5" /> Ready
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <span className="max-w-[80%] self-end rounded-xl rounded-br-sm bg-sidebar px-2.5 py-1.5 text-[9px] text-sidebar-ink">
          how long is user data retained?
        </span>
        <div className="max-w-[85%] self-start">
          <span className="block rounded-xl rounded-bl-sm bg-surface-muted px-2.5 py-1.5 text-[9px] leading-relaxed text-ink">
            Account data is kept for 30 days after deletion, then permanently removed (section 4.2).
          </span>
          <span className="mt-1 inline-block max-w-full truncate rounded-full bg-accent-blue/10 px-1.5 py-0.5 text-[8px] font-medium text-accent-blue">
            privacy_policy_2026.pdf
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

/* ---- Showcase ---- */

interface Feature {
  id: string;
  title: string;
  description: string;
  mock: () => ReactNode;
}

const FEATURES: Feature[] = [
  {
    id: "genui",
    title: "Generative UI",
    description: "Describe the dashboard you want — charts, stats, even whole pages appear.",
    mock: GenUiMock,
  },
  {
    id: "doc2col",
    title: "Document to Collections",
    description: "Drop a spreadsheet or PDF; it becomes a structured, editable collection.",
    mock: DocToCollectionMock,
  },
  {
    id: "prompting",
    title: "Easy Prompting",
    description: "Mention collections and fields inline — your data completes itself.",
    mock: EasyPromptingMock,
  },
  {
    id: "knowledge",
    title: "Knowledge Base",
    description: "Upload documents, then chat with answers grounded in what you uploaded.",
    mock: KnowledgeBaseMock,
  },
];

/**
 * Left rail of the auth pages: the brand plus a self-rotating, free-floating
 * preview of each core feature (no card chrome — the miniature screens ARE
 * the content). Feature names double as navigation, with a timed progress
 * line under the active one.
 */
const EXIT_MS = 220;

export function AuthShowcase() {
  const [index, setIndex] = useState(0);
  // false during the exit animation, flips back on swap → enter animation.
  const [entering, setEntering] = useState(true);
  // Remount key for the progress line so a manual switch restarts the timer.
  const [cycle, setCycle] = useState(0);

  // Crossfade: play the exit, then swap content (remount = enter animation).
  function advance(next?: number) {
    setEntering(false);
    window.setTimeout(() => {
      setIndex((prev) => next ?? (prev + 1) % FEATURES.length);
      setEntering(true);
      setCycle((prev) => prev + 1);
    }, EXIT_MS);
  }

  useEffect(() => {
    const timer = setInterval(() => advance(), ROTATE_MS);
    return () => clearInterval(timer);
  }, [cycle]);

  const feature = FEATURES[index];

  return (
    <aside className="relative hidden min-h-screen flex-1 overflow-hidden rounded-r-[1rem] bg-sidebar px-12 py-10 lg:flex 2xl:py-14">
      {/* Ambient glow — quiet, derived from the app's hero gradient. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-hero-from opacity-[0.14] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent-blue opacity-[0.12] blur-3xl"
      />

      {/* Inner column is width-capped and centered so ultrawide screens don't
          leave the content pinned to the corner of an empty field. */}
      <div className="relative mx-auto flex w-full max-w-xl flex-col justify-between 2xl:max-w-2xl">
      <div className="relative flex items-center gap-3">
        <BrandMark className="h-10 w-10" />
        <span className="text-sm font-semibold tracking-tight text-sidebar-ink">Bijustubu</span>
      </div>

      <div className="relative flex flex-col gap-7">
        {/* Keyed so every rotation replays the entrance — text first, mock
            after; the whole block drifts out (fade-out-up) before swapping. */}
        <div
          key={feature.id}
          className={cn("flex flex-col gap-7", !entering && "animate-fade-out-up")}
        >
          <div className="animate-fade-in-up">
            <h2 className="text-3xl font-bold tracking-tight text-sidebar-ink 2xl:text-5xl">
              {feature.title}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-sidebar-ink/60 2xl:mt-3 2xl:max-w-md 2xl:text-base">
              {feature.description}
            </p>
          </div>
          <div
            className="origin-top-left animate-fade-in-up 2xl:scale-125"
            style={{ "--stagger": "90ms" } as CSSProperties}
          >
            {feature.mock()}
          </div>
        </div>
      </div>

      <nav className="relative flex flex-col gap-1" aria-label="Feature highlights">
        {FEATURES.map((entry, entryIndex) => {
          const active = entryIndex === index;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                if (entryIndex !== index) advance(entryIndex);
              }}
              className={cn(
                "group w-fit py-1 text-left text-sm font-medium transition-colors duration-200 2xl:text-base",
                active ? "text-sidebar-ink" : "text-sidebar-ink/40 hover:text-sidebar-ink/70",
              )}
            >
              {entry.title}
              <span className="mt-0.5 block h-px w-full overflow-hidden bg-sidebar-ink/15">
                {active && (
                  <span
                    key={cycle}
                    className="block h-full animate-grow-x bg-sidebar-ink"
                    style={{ "--grow-duration": `${ROTATE_MS}ms` } as CSSProperties}
                  />
                )}
              </span>
            </button>
          );
        })}
      </nav>
      </div>
    </aside>
  );
}
