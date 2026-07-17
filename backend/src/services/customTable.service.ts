import { Connection } from "mongoose";
import { completeJSON } from "./llmClient.service.js";
import { CustomTable, CustomTableSchema } from "../schemas/customTable.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { assertWhitelisted, buildPipeline } from "./genUI.pipelineBuilder.service.js";

const SYSTEM_PROMPT = `You translate a user's natural-language request into a SINGLE table view over
their own data collections, so they never write a database query themselves. You do NOT write MongoDB
queries or code — you only describe what data the table needs using a constrained query description
(the "query DSL" below). A backend service translates your query DSL into a safe, read-only database
query; you cannot express anything outside this DSL.

Respond with ONLY a single JSON object with this exact shape:
{
  "title": string,                          // short human title for the table
  "columns": [ { "field": string, "label": string } ],  // 1-12; every "field" must exist in the result rows
  "query": QueryDSL
}

QueryDSL shape:
{
  "collection": string,                 // must be one of the existing collection names below
  "joins": [ { "collection": string, "localField": string, "foreignField": string, "as": string } ],  // max 3, only between collections that have a defined relation below
  "filters": [ { "field": string, "op": "eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"in"|"nin"|"contains", "value": string|number|boolean|array } ],  // max 10
  "groupBy": [ string | { "field": string, "granularity": "day"|"week"|"month"|"quarter"|"year" } ],
                                        // max 5 entries; REQUIRES at least one metric when non-empty.
                                        // A plain string groups by the raw field value; the object form
                                        // buckets a DATE-typed field by calendar period (use for time
                                        // series like "sales per month" — never on non-date fields).
  "metrics": [ { "field": string|null, "func": "sum"|"avg"|"count"|"min"|"max", "alias": string } ],  // max 6; "field" is required unless func is "count"
  "topN": { "n": number, "includeOther": boolean } | null,
                                        // keep only the n (1-50) largest groups; includeOther collapses
                                        // the rest into one "Other" row. Requires exactly one groupBy
                                        // entry and at least one metric; includeOther only when every
                                        // metric func is sum or count.
  "sort": { "field": string, "dir": "asc"|"desc" } | null,
  "limit": number  // 1-1000
}

Rules:
- Only reference collection and field names that actually exist in the "Existing collections" list below.
- The user may reference a collection by wrapping its name in curly braces, e.g. {products} — treat
  that as the corresponding collection.
- Only use "joins" between collection pairs that appear in the "Existing relations" list below; never
  invent a relation.
- For raw row listings (e.g. "show all orders from June") leave "metrics" as an empty array [] and
  point "columns" at the row fields. For aggregations (e.g. "total sales per category") use groupBy +
  metrics, and point "columns" at the groupBy fields and metric aliases.
- When filtering on a text value the user typed (a category, a name, a status), prefer op "contains"
  (case-insensitive substring) over "eq" — user-typed values rarely match stored casing/wording exactly.
  Use "eq" only for numbers, booleans, or values you can see verbatim in the field list.
- Output JSON only, no prose, no markdown fences.`;

export interface CustomTableResult {
  title: string;
  columns: CustomTable["columns"];
  rows: Record<string, unknown>[];
  /** The validated DSL behind the rows — returned so the client can save the table. */
  query: CustomTable["query"];
}

export async function generateCustomTable(
  conn: Connection,
  prompt: string,
): Promise<CustomTableResult> {
  const MetaCollection = getMetaCollectionModel(conn);
  const MetaRelation = getMetaRelationModel(conn);

  const collections = await MetaCollection.find().lean();
  const relations = await MetaRelation.find().lean();

  const collectionSummaries = collections.map((c) => ({
    name: c.name,
    displayName: c.displayName,
    rowCount: c.rowCount,
    fields: c.fields.map((f: { name: string; type: string }) => ({ name: f.name, type: f.type })),
  }));

  const relationSummaries = relations.map((r) => ({
    fromCollection: r.fromCollection,
    toCollection: r.toCollection,
    fromField: r.fromField,
    toField: r.toField,
    type: r.type,
  }));

  const userPrompt = `User request: ${prompt}

Existing collections:
${collectionSummaries.length ? JSON.stringify(collectionSummaries, null, 2) : "(none — there is no data to show yet)"}

Existing relations:
${relationSummaries.length ? JSON.stringify(relationSummaries, null, 2) : "(none)"}`;

  const spec = await completeJSON(SYSTEM_PROMPT, userPrompt, CustomTableSchema);

  const known = new Set(collectionSummaries.map((c) => c.name));
  if (!known.has(spec.query.collection)) {
    return { title: spec.title, columns: spec.columns, rows: [], query: spec.query };
  }
  for (const join of spec.query.joins) {
    if (!known.has(join.collection)) {
      throw new Error(`Custom table joins an unknown collection: ${join.collection}`);
    }
  }

  const pipeline = buildPipeline(spec.query);
  assertWhitelisted(pipeline);

  const rows = await conn
    .collection(spec.query.collection)
    .aggregate(pipeline, { allowDiskUse: false })
    .toArray();

  return {
    title: spec.title,
    columns: spec.columns,
    rows: rows as Record<string, unknown>[],
    query: spec.query,
  };
}
