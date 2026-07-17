import { Connection } from "mongoose";
import { z } from "zod";
import { completeJSON } from "./llmClient.service.js";
import { UiSpec, UiSpecSchema } from "../schemas/uiSpec.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { formatCollectionsContext, formatRelationsContext } from "./llmSchemaContext.util.js";
import { validateUiSpecReferences } from "./genUI.specValidator.service.js";
import type { CollectionShape, RelationShape } from "./genUI.specValidator.service.js";

const SYSTEM_PROMPT = `You generate a declarative UI spec — a full page layout — from a user's
natural-language request, so they never have to write a database query themselves. You never write
MongoDB queries — data needs are described with a constrained query description (the "query DSL"
below) that a backend service translates into a safe, read-only database query; you cannot express
anything outside this DSL.

The user may ask for anything from a single chart to a whole report or landing-style page — compose
freely: section headings via "text" widgets, KPI rows of stat-cards, chart areas, lists, tables, and
free-form designed sections via "html" widgets. Match the composition to the request; don't force a
shape the user didn't ask for.

When the request is a landing page / marketing-style page / custom-designed layout, the page must be
CARRIED by "html" widgets — not approximated with charts. A single small banner above a standard
chart dashboard is NOT a landing page. Compose it like a real landing page: a large hero (headline,
subheadline, CTA-styled buttons), several designed content sections (feature/benefit grids of 3-6
cards, highlight strips, alternating two-column sections, testimonial/quote blocks as fits the data's
story), and a footer — each as its own substantial "html" widget. Interleave data widgets
(stat-cards/charts/tables) between html sections only where live numbers strengthen the story.

LAYOUT: the page is a 12-column grid (each row unit is ~56px tall). Every widget gets a "grid" rect
{ "x": 0-11, "y": row, "w": 1-12, "h": rows }. Widgets must not overlap. Typical sizes:
text heading h:1 w:12; stat-card w:3 h:3; charts w:6 h:6; data-table w:12 h:7; list/progress w:4-6 h:6.

Respond with ONLY a single JSON object with this exact shape:
{
  "title": string,
  "layout": "grid-3col",          // legacy field, always output "grid-3col"
  "widgets": [
    {
      "id": string,               // short unique slug
      "title": string,
      "type": "stat-card",
      "query": QueryDSL,
      "grid": { "x": number, "y": number, "w": number, "h": number },
      "valueField": string,       // must be an alias produced by query.metrics
      "deltaField": string | null,
      "compare": { "dateField": string, "period": "day"|"week"|"month"|"quarter"|"year" } | null,
                                  // period-over-period comparison computed by the backend: the card
                                  // shows the current period's value and a % change vs the previous
                                  // period. Requires an empty groupBy. When set, also set
                                  // "deltaField": "deltaPct" to display the change.
      "sparkline": boolean        // only meaningful with "compare": adds a small trend line to the card
    }
    // OR type "data-table": also include "columns": [{ "field": string, "label": string }] (1-12 entries)
    // OR type "bar-chart" / "line-chart" / "area-chart": also include "xField", "yField", optional "seriesField" (string|null)
    // OR type "scatter-chart": also include "xField", "yField" (both numeric fields)
    // OR type "pie-chart" / "donut-chart": also include "labelField", "valueField"
    // OR type "list": also include "titleField", optional "subtitleField" (string|null), optional "valueField" (string|null) — renders rows like an activity feed
    // OR type "progress": also include "valueField", optional "labelField" (string|null), optional "maxValue" (number|null) — renders horizontal progress bars per row
    // OR type "text": NO query and NO title — instead { "id", "type": "text", "variant": "heading"|"subheading"|"body"|"quote", "content": string, "grid": {...} } — use for section headings, explanatory copy, page intros
    // OR type "html": NO query and NO title — instead { "id", "type": "html", "content": string, "grid": {...} } — a free-form page section
  ]
}

"html" widget rules (free-form designed sections — heroes, feature grids, pricing cards, CTAs, footers):
- "content" is an HTML fragment (max ~30000 chars) styled with inline style attributes and/or one <style>
  block at the top of the fragment. Styles are scoped to the section — design boldly: gradients, spacing,
  typography, responsive flex/grid layouts.
- STRICTLY FORBIDDEN inside "content": <script>, <iframe>, <object>, <embed>, <form>, event-handler
  attributes (onclick etc.), javascript: URLs, external stylesheets/fonts, and any tracking. The backend
  strips them — don't rely on them for the design.
- Images: only use https URLs the user explicitly provided, or decorative inline <svg> you draw yourself.
  Never invent external image URLs.
- Content must be professional and family-friendly — no vulgar, explicit, hateful, or violent content.
- Static content only: numbers you write into HTML are frozen text. When the user wants live data on the
  page, add stat-card/chart/table widgets between html sections rather than hardcoding values.
- Be generous and polished, never minimal: each html section should be real landing-page quality with
  layout (flex/grid), spacing, typography hierarchy, and color — use the content budget (up to ~30000
  chars per widget). A one-line banner div is a failure.
- Pages render SEAMLESSLY: all widgets of a page spec are stacked edge-to-edge inside one page surface
  (html sections full-bleed, data widgets embedded between them on a white background). So: give every
  html section its own full-width background (color/gradient) and generous vertical padding (60-100px),
  make adjacent sections' palettes flow into one coherent visual theme (pick ONE palette for the whole
  page and reuse it in every section), and when a data widget follows, let the preceding html section
  end with a heading/intro that introduces it. Never leave a section as unstyled text on white.
- For a landing/marketing page, most widgets (roughly 60%+) should be "html" sections; keep data widgets
  to the few places where live numbers genuinely strengthen the story.

QueryDSL shape:
{
  "collection": string,                 // must be one of the existing collection names below
  "joins": [ { "collection": string, "localField": string, "foreignField": string, "as": string } ],  // max 3, only between collections that have a defined relation below
  "filters": [ { "field": string, "op": "eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"in"|"nin"|"contains", "value": string|number|boolean|array } ],  // max 10
  "groupBy": [ string | { "field": string, "granularity": "day"|"week"|"month"|"quarter"|"year" } ],
                                        // max 5 entries; REQUIRES at least one metric when non-empty.
                                        // A plain string groups by the raw field value. The object form
                                        // buckets a DATE-typed field by calendar period — use it for any
                                        // time series ("sales per month", "signups per week").
  "metrics": [ { "field": string|null, "func": "sum"|"avg"|"count"|"min"|"max", "alias": string } ],  // max 6; "field" is required unless func is "count"
  "topN": { "n": number, "includeOther": boolean } | null,
                                        // keep only the n (1-50) largest groups; includeOther collapses the
                                        // remaining groups into one "Other" row. Requires exactly one groupBy
                                        // entry and at least one metric; includeOther only works when every
                                        // metric func is sum or count.
  "sort": { "field": string, "dir": "asc"|"desc" } | null,
  "limit": number  // 1-1000
}

Time series: when the user asks for a trend over time ("per month", "over the year", "daily"),
group with { "field": <date field>, "granularity": ... } on a date-typed field, set the chart's
xField to that same field name, and sort by it ascending. Never bucket non-date fields.

Top-N: when the user asks for "top 5 X" / "biggest categories and the rest", set "topN" — with
"includeOther": true when the remainder should show as one "Other" slice/bar (pie and donut charts
almost always want this).

Period comparison: when the user asks how a number changed vs the previous period ("this month vs
last month", "compared to last week"), use a stat-card with "compare" (and "deltaField": "deltaPct").
Add "sparkline": true when a small trend adds context. The backend computes the periods — do not add
date filters for this yourself.

Critical rule about metrics: leave "metrics" as an EMPTY array [] for "data-table" widgets that should show
raw rows (e.g. "list of users") — do not force an aggregation on a table that's meant to list records.
Use non-empty "metrics" (and usually "groupBy") for stat-card/bar-chart/line-chart/pie-chart/donut-chart
widgets that need aggregated numbers. A stat-card's "valueField" MUST equal the alias of one of its own
query's metrics.

Rules:
- Only reference collection and field names that actually exist in the "Existing collections" list below.
- The user may reference a collection by wrapping its name in curly braces, e.g. {products} — treat
  that as the corresponding collection.
- Only use "joins" between collection pairs that appear in the "Existing relations" list below — if the
  user wants a join that has no defined relation, either omit that join or use the closest matching
  relation available; never invent a relation.
- Produce between 1 and 16 widgets that best answer the user's request. Prefer a focused composition
  over an exhaustive one, but use "text" headings to structure richer pages into sections.
- "text" widgets contain plain text only — never HTML, markdown syntax, code, or scripts.
- Output JSON only, no prose, no markdown fences.`;

interface SpecContext {
  collectionShapes: CollectionShape[];
  relationShapes: RelationShape[];
  /** "Existing collections/relations" block appended to user prompts. */
  contextBlock: string;
}

async function loadSpecContext(conn: Connection): Promise<SpecContext> {
  const MetaCollection = getMetaCollectionModel(conn);
  const MetaRelation = getMetaRelationModel(conn);

  const collections = await MetaCollection.find().lean();
  const relations = await MetaRelation.find().lean();

  const collectionShapes: CollectionShape[] = collections.map((c) => ({
    name: c.name,
    fields: c.fields.map((f: { name: string; type: string }) => ({ name: f.name, type: f.type })),
  }));
  const relationShapes: RelationShape[] = relations.map((r) => ({
    fromCollection: r.fromCollection,
    toCollection: r.toCollection,
  }));

  const contextBlock = `Existing collections:
${collections.length
    ? formatCollectionsContext(
        collections.map((c) => ({
          name: c.name,
          displayName: c.displayName,
          rowCount: c.rowCount,
          fields: c.fields as { name: string; type: string; nullable?: boolean }[],
        })),
      )
    : "(none — there is no data to visualize yet)"}

Existing relations:
${formatRelationsContext(relations)}`;

  return { collectionShapes, relationShapes, contextBlock };
}

/** Drops widgets that still fail grounding; throws when nothing survives. */
function stripInvalidWidgets(
  spec: UiSpec,
  invalidWidgetIds: Set<string>,
): UiSpec {
  const widgets = spec.widgets.filter((w) => !invalidWidgetIds.has(w.id));
  if (widgets.length === 0) {
    throw new Error("generated dashboard only referenced data that does not exist");
  }
  return { ...spec, widgets };
}

export async function generateUiSpec(conn: Connection, prompt: string): Promise<UiSpec> {
  const context = await loadSpecContext(conn);

  const userPrompt = `User request: ${prompt}

${context.contextBlock}`;

  let spec = await completeJSON(SYSTEM_PROMPT, userPrompt, UiSpecSchema);

  // Schema validity isn't grounding: the model can still invent field names,
  // which render as silently-empty widgets. Give it one repair round with the
  // concrete errors, then drop whatever is still broken.
  let validation = validateUiSpecReferences(spec, context.collectionShapes, context.relationShapes);
  if (validation.errors.length > 0) {
    const repairPrompt = `${userPrompt}

Your previous spec was:
${JSON.stringify(spec)}

It references collections/fields that do not exist:
${validation.errors.join("\n")}

Produce a corrected spec that only references existing collections, fields, join aliases, and metric aliases. Respond with ONLY the corrected JSON object.`;
    spec = await completeJSON(SYSTEM_PROMPT, repairPrompt, UiSpecSchema);
    validation = validateUiSpecReferences(spec, context.collectionShapes, context.relationShapes);
  }

  if (validation.errors.length > 0) {
    spec = stripInvalidWidgets(spec, validation.invalidWidgetIds);
  }

  return spec;
}

const RevisionResponseSchema = z.object({
  uiSpec: UiSpecSchema,
  note: z.string().min(1).max(400),
});

export interface DashboardChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Prompt-driven edit of an existing dashboard spec: the model receives the
 * current spec plus recent chat history and returns the FULL updated spec
 * with a short human note describing the change. Grounding validation and
 * repair mirror generateUiSpec.
 */
export async function reviseUiSpec(
  conn: Connection,
  currentSpec: UiSpec,
  history: DashboardChatMessage[],
  prompt: string,
): Promise<{ uiSpec: UiSpec; note: string }> {
  const context = await loadSpecContext(conn);

  const userPrompt = `REVISION MODE: you are EDITING an existing dashboard spec, not creating a new one.
Apply the user's requested change and keep everything they did not ask to change (ids, titles,
widgets, order) as-is. Respond with ONLY this JSON shape:
{ "uiSpec": <the FULL updated spec in the exact shape defined in the system prompt>, "note": <one short sentence describing what you changed> }

Conversation so far:
${history.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n") || "(none)"}

Current spec:
${JSON.stringify(currentSpec)}

User's change request: ${prompt}

${context.contextBlock}`;

  let revision = await completeJSON(SYSTEM_PROMPT, userPrompt, RevisionResponseSchema);
  let validation = validateUiSpecReferences(
    revision.uiSpec,
    context.collectionShapes,
    context.relationShapes,
  );
  if (validation.errors.length > 0) {
    const repairPrompt = `${userPrompt}

Your previous revision was:
${JSON.stringify(revision.uiSpec)}

It references collections/fields that do not exist:
${validation.errors.join("\n")}

Produce a corrected revision. Respond with ONLY the {"uiSpec": ..., "note": ...} JSON object.`;
    revision = await completeJSON(SYSTEM_PROMPT, repairPrompt, RevisionResponseSchema);
    validation = validateUiSpecReferences(
      revision.uiSpec,
      context.collectionShapes,
      context.relationShapes,
    );
  }

  const uiSpec =
    validation.errors.length > 0
      ? stripInvalidWidgets(revision.uiSpec, validation.invalidWidgetIds)
      : revision.uiSpec;

  return { uiSpec, note: revision.note };
}
