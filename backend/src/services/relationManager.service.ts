import { Connection } from "mongoose";
import { completeJSON } from "./llmClient.service.js";
import { RelationUpdate, RelationUpdateSchema } from "../schemas/relationUpdate.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { formatCollectionsContext, formatRelationsContext } from "./llmSchemaContext.util.js";

const SYSTEM_PROMPT = `You help users define relationships between MongoDB collections in their own
database using plain language, so they never have to write a query themselves.

Respond with ONLY a single JSON object with this exact shape:
{
  "operations": [
    { "op": "add-field", "collection": string, "field": string, "fieldType": "string"|"number"|"boolean"|"date"|"array"|"object", "reason": string },
    { "op": "add", "fromCollection": string, "toCollection": string, "fromField": string, "toField": string, "type": "one-to-one"|"one-to-many"|"many-to-many", "description": string },
    { "op": "remove", "fromCollection": string, "toCollection": string },
    { "op": "update", "fromCollection": string, "toCollection": string, "fromField"?: string, "toField"?: string, "type"?: "one-to-one"|"one-to-many"|"many-to-many", "description"?: string }
  ],
  "summary": string
}

Rules:
- Reference collections by their MACHINE NAME — the snake_case token at the start of each line in the
  "Existing collections" list — never by the quoted display name. Field names must exist on their
  collection too — with two exceptions: "_id" always exists on every collection, and a field you
  create earlier in the same operations list via "add-field".
- When the user asks to LINK/relate collections, the operations MUST include an "add" relation op.
  An "add-field" alone never creates a link — it only prepares the foreign-key column.
- When the user wants to link collections but the source collection has NO suitable foreign-key field
  (e.g. "give every sales record a PIC from contacts" and sales_records has no contact field), emit an
  "add-field" operation FIRST (e.g. field "pic_id", fieldType usually "string") and then the "add"
  relation that uses it — typically pointing at the target collection's "_id". Prefer reusing a
  plausible existing field over creating a new one; only add a field when genuinely needed.
- "add-field" creates the field empty (null) on all existing rows — mention in "summary" that the user
  still needs to fill it in.
- The user may reference a collection by wrapping its name in curly braces, e.g. {products} — treat
  that as the corresponding collection.
- If the user's request is ambiguous or references a collection/field that doesn't exist, do your best to
  infer the closest sensible match rather than failing, and explain your interpretation in "summary".
- "add" creates or overwrites the relation between the given collection pair; "update" partially edits an
  existing relation; "remove" deletes it.
- Output JSON only, no prose, no markdown fences.`;

export async function updateRelationsFromPrompt(
  conn: Connection,
  prompt: string,
): Promise<{ update: RelationUpdate; applied: boolean }> {
  const MetaCollection = getMetaCollectionModel(conn);
  const MetaRelation = getMetaRelationModel(conn);

  const collections = await MetaCollection.find().lean();
  const relations = await MetaRelation.find().lean();

  const userPrompt = `User request: ${prompt}

Existing collections:
${formatCollectionsContext(
    collections.map((c) => ({
      name: c.name,
      displayName: c.displayName,
      fields: c.fields as { name: string; type: string; nullable?: boolean }[],
    })),
  )}

Existing relations:
${formatRelationsContext(relations)}`;

  const update = await completeJSON(SYSTEM_PROMPT, userPrompt, RelationUpdateSchema);

  // The model sometimes references collections by display name despite the
  // instructions — resolve either form instead of silently dropping the op.
  const nameByReference = new Map<string, string>();
  for (const c of collections) {
    nameByReference.set(c.name.toLowerCase(), c.name);
    nameByReference.set(c.displayName.toLowerCase(), c.name);
  }
  const resolveCollection = (reference: string): string | null =>
    nameByReference.get(reference.trim().toLowerCase()) ?? null;

  const skipped: string[] = [];

  // Field creations first so relations emitted before their add-field (the
  // model doesn't always order them correctly) still land on a real field.
  const ordered = [
    ...update.operations.filter((op) => op.op === "add-field"),
    ...update.operations.filter((op) => op.op !== "add-field"),
  ];

  for (const operation of ordered) {
    if (operation.op === "add-field") {
      const collectionName = resolveCollection(operation.collection);
      if (!collectionName) {
        skipped.push(`add-field: unknown collection "${operation.collection}"`);
        continue;
      }
      const meta = collections.find((c) => c.name === collectionName);
      const alreadyExists = meta?.fields.some(
        (f: { name: string }) => f.name === operation.field,
      );
      if (alreadyExists) continue;
      await MetaCollection.updateOne(
        { name: collectionName },
        {
          $push: {
            fields: { name: operation.field, type: operation.fieldType, nullable: true },
          },
        },
      );
      // Same semantics as the manual add-field endpoint: null on existing rows.
      await conn
        .collection(collectionName)
        .updateMany({}, { $set: { [operation.field]: null } });
      continue;
    }

    const fromCollection = resolveCollection(operation.fromCollection);
    const toCollection = resolveCollection(operation.toCollection);
    if (!fromCollection || !toCollection) {
      skipped.push(
        `${operation.op}: unknown collection "${!fromCollection ? operation.fromCollection : operation.toCollection}"`,
      );
      continue;
    }

    if (operation.op === "remove") {
      await MetaRelation.deleteOne({ fromCollection, toCollection });
      continue;
    }

    if (operation.op === "add") {
      await MetaRelation.findOneAndUpdate(
        { fromCollection, toCollection },
        {
          $set: {
            fromField: operation.fromField,
            toField: operation.toField,
            type: operation.type,
            description: operation.description,
            createdVia: "nl-prompt",
          },
        },
        { upsert: true },
      );
      continue;
    }

    // op === "update": partial patch of an existing relation only
    const patch: Record<string, unknown> = {};
    if (operation.fromField) patch.fromField = operation.fromField;
    if (operation.toField) patch.toField = operation.toField;
    if (operation.type) patch.type = operation.type;
    if (operation.description) patch.description = operation.description;
    if (Object.keys(patch).length > 0) {
      await MetaRelation.updateOne({ fromCollection, toCollection }, { $set: patch });
    }
  }

  // Skipped ops must be visible to the user, not silently swallowed — this is
  // exactly how "it only created the field" confusion happens.
  const summary =
    skipped.length > 0
      ? `${update.summary} (Note: ${skipped.length} operation(s) skipped — ${skipped.join("; ")})`
      : update.summary;

  return { update: { ...update, summary }, applied: true };
}
