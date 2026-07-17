import { useMemo } from "react";
import type { CSSProperties } from "react";
import { StatCard } from "@/components/genui/StatCard";
import { TextBlock } from "@/components/genui/TextBlock";
import { HtmlSection } from "@/components/genui/HtmlSection";
import { WidgetCard } from "@/components/genui/WidgetCard";
import { cn } from "@/lib/utils";
import type { StatCardWidget, UiSpec, Widget, WidgetData, WidgetRow } from "@/types/dashboard";

interface WidgetStackProps {
  uiSpec: UiSpec;
  data: WidgetData[];
}

/** Consecutive stat-cards render side by side; everything else stacks full width. */
type StackEntry =
  | { kind: "stat-row"; widgets: StatCardWidget[] }
  | { kind: "single"; widget: Exclude<Widget, StatCardWidget> };

function groupWidgets(widgets: Widget[]): StackEntry[] {
  const entries: StackEntry[] = [];
  for (const widget of widgets) {
    if (widget.type === "stat-card") {
      const last = entries[entries.length - 1];
      if (last && last.kind === "stat-row") {
        last.widgets.push(widget);
      } else {
        entries.push({ kind: "stat-row", widgets: [widget] });
      }
    } else {
      entries.push({ kind: "single", widget });
    }
  }
  return entries;
}

/**
 * Page-shaped renderer used when the spec contains html sections (landing
 * pages etc.): every widget lives inside ONE seamless surface — html sections
 * full-bleed, data widgets embedded with padding but no card chrome of their
 * own — so the result reads as a single page, not a stack of dashboard cards.
 */
function PageStack({
  entries,
  rowsByWidgetId,
}: {
  entries: StackEntry[];
  rowsByWidgetId: Map<string, WidgetRow[]>;
}) {
  let statCardCount = 0;

  return (
    <div className="animate-fade-in-up overflow-hidden rounded-card border border-border-soft bg-surface shadow-card">
      {entries.map((entry) => {
        if (entry.kind === "stat-row") {
          return (
            <div
              key={entry.widgets[0].id}
              className={cn(
                "grid gap-4 px-6 py-6 sm:grid-cols-2",
                entry.widgets.length >= 3 && "xl:grid-cols-3",
                entry.widgets.length >= 4 && "xl:grid-cols-4",
              )}
            >
              {entry.widgets.map((widget) => {
                const paletteIndex = statCardCount;
                statCardCount += 1;
                return (
                  <StatCard
                    key={widget.id}
                    widget={widget}
                    rows={rowsByWidgetId.get(widget.id) ?? []}
                    sparklineRows={rowsByWidgetId.get(`${widget.id}::sparkline`)}
                    paletteIndex={paletteIndex}
                  />
                );
              })}
            </div>
          );
        }

        const widget = entry.widget;
        if (widget.type === "html") {
          return <HtmlSection key={widget.id} widget={widget} />;
        }
        if (widget.type === "text") {
          return (
            <div key={widget.id} className="px-6 py-6">
              <TextBlock widget={widget} />
            </div>
          );
        }
        return (
          <WidgetCard
            key={widget.id}
            widget={widget}
            rows={rowsByWidgetId.get(widget.id) ?? []}
            variant="plain"
          />
        );
      })}
    </div>
  );
}

/**
 * Static, list-shaped dashboard renderer: widgets stack vertically in
 * full-width cards (stat-cards share a responsive row). No dragging, no
 * resizing, no grid — generations always render cleanly regardless of what
 * layout the LLM proposed. Specs containing html sections switch to the
 * seamless PageStack instead.
 */
export function WidgetStack({ uiSpec, data }: WidgetStackProps) {
  const rowsByWidgetId = useMemo(
    () => new Map(data.map((entry) => [entry.widgetId, entry.rows])),
    [data],
  );
  const entries = useMemo(() => groupWidgets(uiSpec.widgets), [uiSpec.widgets]);

  if (uiSpec.widgets.some((widget) => widget.type === "html")) {
    return <PageStack entries={entries} rowsByWidgetId={rowsByWidgetId} />;
  }

  let statCardCount = 0;
  let index = 0;

  return (
    <div className="flex flex-col gap-5">
      {entries.map((entry) => {
        const stagger = { "--stagger": `${Math.min(index, 8) * 60}ms` } as CSSProperties;
        index += 1;

        if (entry.kind === "stat-row") {
          return (
            <div
              key={entry.widgets[0].id}
              className={cn(
                "grid animate-fade-in-up gap-4 sm:grid-cols-2",
                entry.widgets.length >= 3 && "xl:grid-cols-3",
                entry.widgets.length >= 4 && "xl:grid-cols-4",
              )}
              style={stagger}
            >
              {entry.widgets.map((widget) => {
                const paletteIndex = statCardCount;
                statCardCount += 1;
                return (
                  <StatCard
                    key={widget.id}
                    widget={widget}
                    rows={rowsByWidgetId.get(widget.id) ?? []}
                    sparklineRows={rowsByWidgetId.get(`${widget.id}::sparkline`)}
                    paletteIndex={paletteIndex}
                  />
                );
              })}
            </div>
          );
        }

        const widget = entry.widget;

        if (widget.type === "text") {
          return (
            <div key={widget.id} className="animate-fade-in-up" style={stagger}>
              <TextBlock widget={widget} />
            </div>
          );
        }

        if (widget.type === "html") {
          return (
            <div
              key={widget.id}
              className="animate-fade-in-up overflow-hidden rounded-card border border-border-soft bg-surface shadow-card"
              style={stagger}
            >
              <HtmlSection widget={widget} />
            </div>
          );
        }

        return (
          <WidgetCard
            key={widget.id}
            widget={widget}
            rows={rowsByWidgetId.get(widget.id) ?? []}
            className="animate-fade-in-up"
            style={stagger}
          />
        );
      })}
    </div>
  );
}
