import { Connection } from "mongoose";
import { ExtractionPlan } from "../schemas/extractionPlan.schema.js";
import { ParsedDocument } from "./documentParser.service.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { normalizeDateFields } from "./dateNormalizer.util.js";

export interface CollectionWriteResult {
  collectionName: string;
  displayName: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  /** Rows written plainly because they had no value for the unique key. */
  rowsMissingKey: number;
}

export interface ApplyOptions {
  /**
   * How a "merge" action treats rows whose unique-key value already exists:
   * "skip" keeps the existing row, "overwrite" $set-updates it. Ignored for
   * other actions. Defaults to "skip".
   */
  duplicateStrategy?: "skip" | "overwrite";
}

const BULK_WRITE_BATCH = 500;

export async function applyExtractionPlan(
  conn: Connection,
  plan: ExtractionPlan,
  rows: Record<string, unknown>[],
  sourceFile: { originalName: string; mimetype: string; sizeBytes: number },
  instruction: string | null,
  options: ApplyOptions = {},
): Promise<CollectionWriteResult> {
  const dataCollection = conn.collection(plan.targetCollection);
  const MetaCollection = getMetaCollectionModel(conn);
  const existing = await MetaCollection.findOne({ name: plan.targetCollection }).lean();

  // Computed before any insert — insertMany mutates rows by adding _id.
  // Date-looking string columns (e.g. "7/4/2015") are upgraded to real Dates
  // here regardless of what the LLM typed them as; the unique key is excluded
  // because merge/replace dedupe compares key values by identity.
  const dedupeKey =
    plan.action === "merge" || plan.action === "replace"
      ? (existing?.upsertKey ?? plan.upsertKey)
      : null;
  const incomingFields = normalizeDateFields(
    rows,
    reconcileIncomingFields(plan.fields, rows),
    new Map(
      (existing?.fields ?? []).map((f: { name: string; type: string }) => [f.name, f.type]),
    ),
    new Set(dedupeKey ? [dedupeKey] : []),
  );

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedDuplicateCount = 0;
  let rowsMissingKey = 0;

  switch (plan.action) {
    case "create":
    case "append": {
      if (rows.length > 0) {
        const result = await dataCollection.insertMany(rows);
        insertedCount = result.insertedCount;
      }
      break;
    }
    case "merge": {
      // The unique key set by the user on the target collection wins over
      // whatever the LLM proposed; with no key at all merge degrades to a
      // plain append (reported via rowsMissingKey staying 0 / insertedCount).
      const key = existing?.upsertKey ?? plan.upsertKey;
      if (!key) {
        if (rows.length > 0) {
          const result = await dataCollection.insertMany(rows);
          insertedCount = result.insertedCount;
        }
        break;
      }

      const { keyed, unkeyed, inFileDuplicates } = splitRowsByKey(rows, key);
      rowsMissingKey = unkeyed.length;

      if ((options.duplicateStrategy ?? "skip") === "skip") {
        skippedDuplicateCount += inFileDuplicates.length;
        const existingKeys = await findExistingKeyValues(
          conn,
          plan.targetCollection,
          key,
          [...keyed.keys()],
        );
        const freshRows = [...keyed.entries()]
          .filter(([value]) => !existingKeys.has(value))
          .map(([, row]) => row);
        skippedDuplicateCount += keyed.size - freshRows.length;
        if (freshRows.length > 0) {
          const result = await dataCollection.insertMany(freshRows);
          insertedCount = result.insertedCount;
        }
      } else {
        // overwrite: last occurrence in the file wins (splitRowsByKey keeps
        // the last row per key), existing rows are $set-updated in place.
        const upserted = await bulkUpsert(
          conn,
          plan.targetCollection,
          key,
          [...keyed.values()],
        );
        insertedCount = upserted.insertedCount;
        updatedCount = upserted.updatedCount;
      }

      if (unkeyed.length > 0) {
        const result = await dataCollection.insertMany(unkeyed);
        insertedCount += result.insertedCount;
      }
      break;
    }
    case "replace": {
      if (!plan.upsertKey) {
        throw new Error("upsertKey is required for action 'replace'");
      }
      const { keyed, unkeyed } = splitRowsByKey(rows, plan.upsertKey);
      rowsMissingKey = unkeyed.length;
      const upserted = await bulkUpsert(
        conn,
        plan.targetCollection,
        plan.upsertKey,
        [...keyed.values()],
      );
      insertedCount = upserted.insertedCount;
      updatedCount = upserted.updatedCount;
      break;
    }
  }

  const actualRowCount = await dataCollection.countDocuments();
  const mergingIntoExisting = Boolean(existing) && plan.action !== "create";
  const mergedFields = mergeFields(
    existing?.fields ?? [],
    incomingFields,
    mergingIntoExisting,
  );
  const hasInstruction = Boolean(instruction && instruction.trim());

  // Backfill new fields with null on rows that predate them, matching the
  // manual add-field endpoint's semantics.
  if (mergingIntoExisting) {
    const existingNames = new Set(
      (existing!.fields as FieldDef[]).map((field) => field.name),
    );
    for (const field of incomingFields) {
      if (existingNames.has(field.name)) continue;
      await dataCollection.updateMany(
        { [field.name]: { $exists: false } },
        { $set: { [field.name]: null } },
      );
    }
  }

  await MetaCollection.findOneAndUpdate(
    { name: plan.targetCollection },
    {
      $set: {
        displayName: plan.displayName,
        fields: mergedFields,
        sourceFile: { ...sourceFile, uploadedAt: new Date() },
        // A user-set unique field must survive later uploads into the same
        // collection — the plan's key only fills a still-empty setting.
        upsertKey: existing ? (existing.upsertKey ?? plan.upsertKey) : plan.upsertKey,
        rowCount: actualRowCount,
        lastAppendedAt: plan.action === "create" ? null : new Date(),
      },
      $setOnInsert: {
        createdVia: hasInstruction ? "instruction" : "auto",
        instructionText: hasInstruction ? instruction : null,
      },
    },
    { upsert: true },
  );

  if (plan.relations.length > 0) {
    const MetaRelation = getMetaRelationModel(conn);
    for (const relation of plan.relations) {
      await MetaRelation.findOneAndUpdate(
        { fromCollection: plan.targetCollection, toCollection: relation.toCollection },
        {
          $set: {
            fromField: relation.fromField,
            toField: relation.toField,
            type: relation.type,
            description: relation.description,
            createdVia: "upload-instruction",
          },
        },
        { upsert: true },
      );
    }
  }

  return {
    collectionName: plan.targetCollection,
    displayName: plan.displayName,
    rowCount: actualRowCount,
    insertedCount,
    updatedCount,
    skippedDuplicateCount,
    rowsMissingKey,
  };
}

export function toRows(parsed: ParsedDocument, plan: ExtractionPlan): Record<string, unknown>[] {
  // The LLM tends to normalize field names (e.g. "Field Label" → field_label),
  // while parsed rows keep the raw file headers. Rename row keys to the plan's
  // field names wherever they clearly refer to the same column, so the stored
  // data matches the meta schema (otherwise the grid renders empty cells).
  if (parsed.kind === "rows") {
    return remapRowKeys(parsed.rows, plan.fields.map((f) => f.name));
  }
  // Narrative text has no inherent row structure — the extraction planner LLM
  // extracts the structured records itself (see extractionPlanner.service.ts).
  return plan.extractedRecords;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function remapRowKeys(
  rows: Record<string, unknown>[],
  fieldNames: string[],
): Record<string, unknown>[] {
  const byNormalized = new Map<string, string>();
  for (const name of fieldNames) {
    const normalized = normalizeKey(name);
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, name);
  }
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[byNormalized.get(normalizeKey(key)) ?? key] = value;
    }
    return out;
  });
}

type FieldTypeName = "string" | "number" | "boolean" | "date" | "array" | "object";

function inferFieldType(value: unknown): FieldTypeName {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "string";
}

/**
 * Aligns the plan's field list with the rows that will actually be written:
 * plan fields no row provides are dropped, and row keys the plan missed (e.g.
 * unnamed spreadsheet columns) get an inferred descriptor — the meta schema
 * must describe the real data or the collection renders as empty columns.
 */
export function reconcileIncomingFields(
  planFields: { name: string; type: FieldTypeName; nullable: boolean }[],
  rows: Record<string, unknown>[],
): { name: string; type: FieldTypeName; nullable: boolean }[] {
  if (rows.length === 0) return planFields;

  const sampleByKey = new Map<string, unknown>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!sampleByKey.has(key) || sampleByKey.get(key) == null) {
        sampleByKey.set(key, value);
      }
    }
  }

  const kept = planFields.filter((field) => sampleByKey.has(field.name));
  const known = new Set(kept.map((field) => field.name));
  const extras = [...sampleByKey.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, value]) => ({
      name: key,
      type: inferFieldType(value),
      nullable: true,
    }));

  return [...kept, ...extras];
}

/**
 * Splits rows into keyed (last occurrence per key value wins) and unkeyed
 * (missing/null/empty key). Earlier rows displaced by a later same-key row
 * are returned in inFileDuplicates so "skip" can count them.
 */
function splitRowsByKey(
  rows: Record<string, unknown>[],
  key: string,
): {
  keyed: Map<unknown, Record<string, unknown>>;
  unkeyed: Record<string, unknown>[];
  inFileDuplicates: Record<string, unknown>[];
} {
  const keyed = new Map<unknown, Record<string, unknown>>();
  const unkeyed: Record<string, unknown>[] = [];
  const inFileDuplicates: Record<string, unknown>[] = [];

  for (const row of rows) {
    const value = row[key];
    if (value === undefined || value === null || value === "") {
      unkeyed.push(row);
      continue;
    }
    const previous = keyed.get(value);
    if (previous) inFileDuplicates.push(previous);
    keyed.set(value, row);
  }
  return { keyed, unkeyed, inFileDuplicates };
}

const KEY_QUERY_BATCH = 1000;

async function findExistingKeyValues(
  conn: Connection,
  collectionName: string,
  key: string,
  values: unknown[],
): Promise<Set<unknown>> {
  const collection = conn.collection(collectionName);
  const existing = new Set<unknown>();
  for (let i = 0; i < values.length; i += KEY_QUERY_BATCH) {
    const batch = values.slice(i, i + KEY_QUERY_BATCH);
    const found = await collection
      .find({ [key]: { $in: batch } })
      .project({ [key]: 1, _id: 0 })
      .toArray();
    for (const doc of found) existing.add((doc as Record<string, unknown>)[key]);
  }
  return existing;
}

async function bulkUpsert(
  conn: Connection,
  collectionName: string,
  key: string,
  rows: Record<string, unknown>[],
): Promise<{ insertedCount: number; updatedCount: number }> {
  const collection = conn.collection(collectionName);
  let insertedCount = 0;
  let updatedCount = 0;
  for (let i = 0; i < rows.length; i += BULK_WRITE_BATCH) {
    const batch = rows.slice(i, i + BULK_WRITE_BATCH);
    const result = await collection.bulkWrite(
      batch.map((row) => ({
        updateOne: {
          filter: { [key]: row[key] },
          update: { $set: row },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    insertedCount += result.upsertedCount;
    updatedCount += result.matchedCount;
  }
  return { insertedCount, updatedCount };
}

interface FieldDef {
  name: string;
  type: string;
  sample?: unknown;
  nullable?: boolean;
}

function mergeFields(
  existing: FieldDef[],
  incoming: FieldDef[],
  intoExistingCollection: boolean,
): FieldDef[] {
  const byName = new Map<string, FieldDef>();
  for (const f of existing) byName.set(f.name, f);
  for (const f of incoming) {
    // Fields new to an existing collection must be nullable: rows written
    // before this upload don't have them (beyond the null backfill).
    if (intoExistingCollection && !byName.has(f.name)) {
      byName.set(f.name, { ...f, nullable: true });
    } else if (!byName.has(f.name)) {
      byName.set(f.name, f);
    } else {
      // Keep the existing descriptor (user may have curated type/nullable).
      const current = byName.get(f.name)!;
      byName.set(f.name, { ...current, sample: current.sample ?? f.sample });
    }
  }
  return [...byName.values()];
}
