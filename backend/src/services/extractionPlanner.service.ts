import { Connection } from "mongoose";
import { completeJSON } from "./llmClient.service.js";
import { ExtractionPlan, ExtractionPlanSchema } from "../schemas/extractionPlan.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { findSimilarCollections, SimilarityCandidate } from "./similarityDetector.service.js";
import { ParsedDocument } from "./documentParser.service.js";
import { formatCollectionLine } from "./llmSchemaContext.util.js";

const SYSTEM_PROMPT = `You are a data-ingestion planner for a per-user document-to-database app.
A user has uploaded a document (already parsed into either row records or raw text) and optionally
gave a free-text instruction. Decide how to store this data as a MongoDB collection.

Respond with ONLY a single JSON object with this exact shape:
{
  "action": "create" | "append" | "replace" | "merge",
  "targetCollection": string,   // lowercase snake_case, 2-64 chars, matches ^[a-z][a-z0-9_]{1,63}$
  "displayName": string,        // human-readable label
  "fields": [ { "name": string, "type": "string"|"number"|"boolean"|"date"|"array"|"object", "nullable": boolean } ],
  "upsertKey": string | null,   // REQUIRED (non-null) when action is "replace" — the field used to dedupe
  "relations": [ { "toCollection": string, "fromField": string, "toField": string, "type": "one-to-one"|"one-to-many"|"many-to-many", "description": string } ],
  "similarityNote": string | null,  // if this data looks similar to an existing collection, explain it here in plain language for the user, even when action is "create"
  "reasoning": string,
  "extractedRecords": [ { ... } ]  // ONLY when the input is raw narrative text (not already-tabular row data): extract
                                    // every structured record you can find, each as a flat JSON object whose keys match
                                    // the "fields" you defined above. Leave this an empty array [] when the input was
                                    // already given to you as row records (CSV/Excel) — do not repeat them here.
}

Rules:
- If the user gave NO instruction, you should generally propose action "create" with a fresh, descriptive
  collection name — but if the data clearly looks like an existing collection, say so in similarityNote.
- If the user gave an instruction, follow it: it may ask for a specific collection name, to append to an
  existing collection, to replace/upsert duplicates (in which case you MUST set upsertKey), to merge data,
  or to define relations to other existing collections.
- fields must reflect the actual structure of the parsed data (or, for narrative text, the structured
  records you extract from it).
- Type a field "date" whenever its values are dates or datetimes in ANY common format — e.g.
  "2015-07-04", "7/4/2015", "04-07-2015", "2015/7/4 13:00" — even though the raw values are strings.
  Field names like *_date, *_at, "Order Date", "tanggal" are a strong hint. Never type such a column "string".
- Only reference toCollection names from the existing collections list below when defining relations.
- Never invent an action or field not in the shape above. Output JSON only, no prose, no markdown fences.`;

export interface ExtractionPlanResult {
  plan: ExtractionPlan;
  similarCollections: SimilarityCandidate[];
}

export async function planExtraction(
  conn: Connection,
  // sql-tables uploads never reach the planner — they apply deterministically
  // in documents.controller (the dump itself is the schema).
  parsed: Extract<ParsedDocument, { kind: "rows" | "text" }>,
  instruction: string | null,
  originalFileName: string,
): Promise<ExtractionPlanResult> {
  const MetaCollection = getMetaCollectionModel(conn);
  const existing = await MetaCollection.find().lean();
  const existingSummaries = existing.map((c) => ({
    name: c.name,
    displayName: c.displayName,
    fields: c.fields.map((f: { name: string }) => f.name),
  }));

  const candidateFieldNames =
    parsed.kind === "rows" && parsed.rows.length > 0 ? Object.keys(parsed.rows[0]) : [];
  const similarCollections = findSimilarCollections(candidateFieldNames, existingSummaries);

  // Compact single-line JSON: 25 pretty-printed rows would dominate the
  // prompt's token budget for no comprehension gain.
  const dataPreview =
    parsed.kind === "rows"
      ? JSON.stringify(parsed.rows.slice(0, 25))
      : parsed.text.slice(0, 6000);

  const existingLines = existing.length
    ? existing
        .map((c) =>
          formatCollectionLine({
            name: c.name,
            displayName: c.displayName,
            rowCount: c.rowCount,
            fields: c.fields as { name: string; type: string; nullable?: boolean }[],
          }),
        )
        .join("\n")
    : "(none yet)";

  const similarLines = similarCollections.length
    ? similarCollections
        .map((c) => `${c.name} (field-name overlap score ${c.score.toFixed(2)})`)
        .join("\n")
    : "(none found)";

  const userPrompt = `File: ${originalFileName}
Instruction from user: ${instruction && instruction.trim() ? instruction.trim() : "(none provided)"}

Existing collections in this user's database (name "Display Name" (rows): field:type, "?" = nullable):
${existingLines}

Heuristically-similar existing collections (field-name overlap):
${similarLines}

Parsed document content (${parsed.kind === "rows" ? "row records" : "raw text, possibly truncated"}):
${dataPreview}`;

  const rawPlan = await completeJSON(SYSTEM_PROMPT, userPrompt, ExtractionPlanSchema);

  const plan = enforcePlanRules(rawPlan, instruction, existingSummaries.map((c) => c.name));

  return { plan, similarCollections };
}

function enforcePlanRules(
  plan: ExtractionPlan,
  instruction: string | null,
  existingNames: string[],
): ExtractionPlan {
  const hasInstruction = Boolean(instruction && instruction.trim());

  let action = plan.action;
  let reasoning = plan.reasoning;

  // Rule: with no instruction, the platform always creates a new collection —
  // the model's own action choice is advisory only in this case.
  if (!hasInstruction && action !== "create") {
    action = "create";
    reasoning = `${reasoning} (forced to "create": no user instruction was provided, so an existing-collection action was overridden.)`;
  }

  let targetCollection = plan.targetCollection;
  if (action === "create" && existingNames.includes(targetCollection)) {
    const candidate = dedupeCollectionName(targetCollection, existingNames);
    reasoning = `${reasoning} (renamed target collection to "${candidate}" to avoid colliding with an existing collection of the same name.)`;
    targetCollection = candidate;
  }

  return { ...plan, action, targetCollection, reasoning };
}

/** Suffixes `name` with _2, _3, ... until it no longer collides with existingNames. */
export function dedupeCollectionName(name: string, existingNames: string[]): string {
  if (!existingNames.includes(name)) return name;
  let suffix = 2;
  let candidate = `${name}_${suffix}`;
  while (existingNames.includes(candidate)) {
    suffix += 1;
    candidate = `${name}_${suffix}`;
  }
  return candidate;
}
