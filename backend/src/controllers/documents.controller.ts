import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { parseDocument } from "../services/documentParser.service.js";
import type { ParsedDocument } from "../services/documentParser.service.js";
import { dedupeCollectionName, planExtraction } from "../services/extractionPlanner.service.js";
import {
  applyExtractionPlan,
  CollectionWriteResult,
  reconcileIncomingFields,
  toRows,
} from "../services/collectionWriter.service.js";
import { buildUploadPreview } from "../services/uploadPreview.service.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import {
  getPendingUploadModel,
  getPendingUploadRowsModel,
  PENDING_UPLOAD_ROWS_PER_CHUNK,
  PENDING_UPLOAD_TTL_MS,
} from "../models/pendingUpload.model.js";
import { markRateLimitSuccess } from "../middleware/rateLimit.js";
import { logActivity } from "../services/activityLog.service.js";

const FREE_COLLECTION_LIMIT = 20;
import { ExtractionPlan } from "../schemas/extractionPlan.schema.js";
import { FIELD_NAME_PATTERN, FieldTypeEnum } from "../schemas/fieldCommon.js";
import { SimilarityCandidate } from "../services/similarityDetector.service.js";

/**
 * Two-phase upload. planUpload parses the file and asks the LLM for an
 * extraction plan; a clean "create" with no similar collections is applied
 * immediately (status "applied"), anything else is staged server-side and
 * returned as "needs-decision" with a preview (field mapping, duplicate
 * counts, sample rows) so the user can pick merge/skip/create-new before any
 * data is written. applyUpload executes the staged plan under the user's
 * decision; cancelUpload discards it.
 *
 * Rate-limit invariant (see CLAUDE.md): the "upload" quota is consumed only
 * when rows are actually written; the "uploadPlan" quota is consumed by every
 * successful LLM planning call.
 */

function writeStatsSummary(collection: CollectionWriteResult): string {
  const parts: string[] = [];
  if (collection.insertedCount > 0) parts.push(`${collection.insertedCount} added`);
  if (collection.updatedCount > 0) parts.push(`${collection.updatedCount} updated`);
  if (collection.skippedDuplicateCount > 0) {
    parts.push(`${collection.skippedDuplicateCount} duplicates skipped`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function appliedResponse(
  plan: ExtractionPlan,
  collection: CollectionWriteResult,
  similarCollections: SimilarityCandidate[],
) {
  return {
    status: "applied" as const,
    plan,
    collection,
    similarityNote: plan.similarityNote,
    similarCollections,
  };
}

/** Hard cap so a pathological dump can't create hundreds of collections. */
const SQL_DUMP_MAX_TABLES = 40;

function sanitizeCollectionName(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 64);
  if (!/^[a-z]/.test(name)) name = `t_${name}`.slice(0, 64);
  if (name.length < 2) name = `${name}_data`;
  return name;
}

/**
 * SQL dumps skip the LLM planner entirely: the dump carries an explicit
 * schema, so every table becomes its own collection deterministically
 * (name-collisions get a numeric suffix) and FOREIGN KEY constraints become
 * relation proposals. Nothing is written here — like every upload, the plans
 * are staged and wait for the user's approval on the Documents page.
 */
async function stageSqlDumpUpload(
  req: Request,
  res: Response,
  conn: mongoose.Connection,
  parsed: Extract<ParsedDocument, { kind: "sql-tables" }>,
  file: Express.Multer.File,
  instruction: string | null,
) {
  const MetaCollection = getMetaCollectionModel(conn);
  const existing = await MetaCollection.find().select("name").lean();
  const existingNames = new Set(existing.map((c) => String(c.name)));

  const tables = parsed.tables.slice(0, SQL_DUMP_MAX_TABLES);

  // Plans keep the BASE (sanitized, un-suffixed) collection name — collisions
  // with existing collections are resolved at apply time by the user's chosen
  // strategy (update-in-place vs suffix copies). Names are only deduped
  // against the dump itself here.
  const collectionNameByTable = new Map<string, string>();
  const namesInDump: string[] = [];
  for (const table of tables) {
    const baseName = dedupeCollectionName(sanitizeCollectionName(table.name), namesInDump);
    namesInDump.push(baseName);
    collectionNameByTable.set(table.name, baseName);
  }

  const plans: ExtractionPlan[] = tables.map((table) => ({
    action: "create",
    targetCollection: collectionNameByTable.get(table.name)!,
    displayName: table.name,
    fields: table.fields.map((field) => ({ name: field.name, type: field.type, nullable: true })),
    // The PK rides along so an "update existing" apply can replace by key.
    upsertKey: table.pk,
    relations: parsed.relations
      .filter((relation) => relation.fromTable === table.name)
      .map((relation) => ({
        toCollection: collectionNameByTable.get(relation.toTable)!,
        fromField: relation.fromField,
        toField: relation.toField,
        type: "one-to-many" as const,
        description: `Imported from SQL foreign key ${relation.fromTable}.${relation.fromField} → ${relation.toTable}.${relation.toField}`,
      })),
    similarityNote: null,
    reasoning:
      "Deterministic SQL dump import — schema from CREATE TABLE, rows from INSERT statements.",
    extractedRecords: [],
  }));

  await markRateLimitSuccess(req.userDbName!, "uploadPlan");

  const sourceFile = {
    originalName: file.originalname,
    mimetype: file.mimetype,
    sizeBytes: file.size,
  };
  const totalRows = tables.reduce((sum, table) => sum + table.rows.length, 0);
  const sqlSummary = {
    tables: tables.map((table, index) => ({
      collectionName: plans[index].targetCollection,
      displayName: table.name,
      rowCount: table.rows.length,
      fields: table.fields,
      /** True when a collection with this name already exists — the approval
          panel then asks whether to update it or import a suffixed copy. */
      exists: existingNames.has(plans[index].targetCollection),
      updatableByKey: plans[index].upsertKey !== null,
    })),
    relations: plans.flatMap((plan) =>
      plan.relations.map((relation) => ({
        fromCollection: plan.targetCollection,
        fromField: relation.fromField,
        toCollection: relation.toCollection,
        toField: relation.toField,
      })),
    ),
  };

  const expiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);
  const PendingUpload = getPendingUploadModel(conn);
  const PendingUploadRows = getPendingUploadRowsModel(conn);
  const pending = await PendingUpload.create({
    plan: plans[0],
    plans,
    sqlSummary,
    sourceFile,
    instruction,
    similarCollections: [],
    preview: { totalRows, sampleRows: [], incomingFields: [], candidates: [] },
    rowCount: totalRows,
    expiresAt,
  });
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const rows = tables[tableIndex].rows;
    for (let i = 0; i < rows.length; i += PENDING_UPLOAD_ROWS_PER_CHUNK) {
      await PendingUploadRows.create({
        pendingId: pending._id,
        tableIndex,
        seq: i / PENDING_UPLOAD_ROWS_PER_CHUNK,
        rows: rows.slice(i, i + PENDING_UPLOAD_ROWS_PER_CHUNK),
        expiresAt,
      });
    }
  }

  res.status(200).json({
    status: "needs-decision" as const,
    pendingId: String(pending._id),
    expiresAt: expiresAt.toISOString(),
    plan: plans[0],
    similarityNote: null,
    similarCollections: [],
    preview: { totalRows, sampleRows: [], incomingFields: [], candidates: [] },
    sqlSummary,
  });
}

export async function planUpload(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "missing_file" });
    return;
  }
  if (!req.userDbName) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction : null;

  let parsed;
  try {
    parsed = await parseDocument(file.buffer, file.mimetype, file.originalname);
  } catch {
    res.status(422).json({ error: "unparsable_file" });
    return;
  }

  const conn = getUserConnection(req.userDbName);

  if (parsed.kind === "sql-tables") {
    await stageSqlDumpUpload(req, res, conn, parsed, file, instruction);
    return;
  }

  const { plan, similarCollections } = await planExtraction(
    conn,
    parsed,
    instruction,
    file.originalname,
  );
  await markRateLimitSuccess(req.userDbName, "uploadPlan");

  const rows = toRows(parsed, plan);
  const sourceFile = {
    originalName: file.originalname,
    mimetype: file.mimetype,
    sizeBytes: file.size,
  };

  // Every upload — even a clean create — stages and waits for the user's
  // approval on the Documents page; nothing is written without a decision.
  // The preview must describe the rows as they'll actually be written, not
  // just the LLM's field list (which can miss unnamed columns).
  const previewPlan = { ...plan, fields: reconcileIncomingFields(plan.fields, rows) };
  const preview = await buildUploadPreview(conn, rows, previewPlan, similarCollections);

  const expiresAt = new Date(Date.now() + PENDING_UPLOAD_TTL_MS);
  const PendingUpload = getPendingUploadModel(conn);
  const PendingUploadRows = getPendingUploadRowsModel(conn);

  const pending = await PendingUpload.create({
    plan,
    sourceFile,
    instruction,
    similarCollections,
    preview,
    rowCount: rows.length,
    expiresAt,
  });
  for (let i = 0; i < rows.length; i += PENDING_UPLOAD_ROWS_PER_CHUNK) {
    await PendingUploadRows.create({
      pendingId: pending._id,
      seq: i / PENDING_UPLOAD_ROWS_PER_CHUNK,
      rows: rows.slice(i, i + PENDING_UPLOAD_ROWS_PER_CHUNK),
      expiresAt,
    });
  }

  res.status(200).json({
    status: "needs-decision" as const,
    pendingId: String(pending._id),
    expiresAt: expiresAt.toISOString(),
    plan,
    similarityNote: plan.similarityNote,
    similarCollections,
    preview,
  });
}

const COLLECTION_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

const FieldOverrideSchema = z.object({
  originalName: z.string().min(1),
  name: z.string().regex(FIELD_NAME_PATTERN),
  type: FieldTypeEnum,
});

const FieldOverridesSchema = z.array(FieldOverrideSchema).max(64).optional();

// fieldOverrides are only meaningful for create-flavored modes; merging must
// conform to the target collection's existing schema, so they're rejected there.
const ApplyDecisionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("apply-plan"),
    fieldOverrides: FieldOverridesSchema,
    /** SQL dumps only: how colliding table names are resolved — "replace"
        updates the existing collection by primary key, "suffix" (default)
        imports a numbered copy. */
    sqlCollisionStrategy: z.enum(["replace", "suffix"]).optional(),
  }),
  z.object({ mode: z.literal("create-new"), fieldOverrides: FieldOverridesSchema }),
  z.object({
    mode: z.literal("merge-into"),
    targetCollection: z.string().regex(COLLECTION_NAME_PATTERN),
    duplicateStrategy: z.enum(["skip", "overwrite"]),
  }),
]);

type FieldOverride = z.infer<typeof FieldOverrideSchema>;

/**
 * Rewrites the staged plan and rows under the user's pre-write schema edits:
 * plan field names/types change, staged row keys are renamed, and
 * upsertKey / relations track renamed fields. Returns an error string when
 * the overrides don't fit the staged plan (unknown source field, duplicate
 * resulting names).
 */
function applyFieldOverrides(
  plan: ExtractionPlan,
  rows: Record<string, unknown>[],
  overrides: FieldOverride[],
): { plan: ExtractionPlan; rows: Record<string, unknown>[] } | { error: string } {
  if (overrides.length === 0) return { plan, rows };

  // Validate against the fields as they'll actually be written (the LLM's
  // list can miss unnamed columns — reconcile fills those in).
  const reconciled = reconcileIncomingFields(plan.fields, rows);
  const byName = new Map(reconciled.map((field) => [field.name, field]));

  const renames = new Map<string, string>();
  for (const override of overrides) {
    if (!byName.has(override.originalName)) {
      return { error: `unknown field "${override.originalName}"` };
    }
    if (override.name !== override.originalName) renames.set(override.originalName, override.name);
  }

  const resultingNames = reconciled.map(
    (field) => overrides.find((o) => o.originalName === field.name)?.name ?? field.name,
  );
  if (new Set(resultingNames).size !== resultingNames.length) {
    return { error: "field overrides produce duplicate field names" };
  }

  const overrideByOriginal = new Map(overrides.map((o) => [o.originalName, o]));
  const fields = reconciled.map((field) => {
    const override = overrideByOriginal.get(field.name);
    return override ? { ...field, name: override.name, type: override.type } : field;
  });

  const renamedRows =
    renames.size === 0
      ? rows
      : rows.map((row) => {
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            next[renames.get(key) ?? key] = value;
          }
          return next;
        });

  return {
    plan: {
      ...plan,
      fields,
      upsertKey: plan.upsertKey ? (renames.get(plan.upsertKey) ?? plan.upsertKey) : plan.upsertKey,
      relations: plan.relations.map((relation) => ({
        ...relation,
        fromField: renames.get(relation.fromField) ?? relation.fromField,
      })),
    },
    rows: renamedRows,
  };
}

export async function applyUpload(req: Request, res: Response) {
  if (!req.userDbName) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const pendingId = String(req.params.pendingId);
  if (!mongoose.Types.ObjectId.isValid(pendingId)) {
    res.status(400).json({ error: "invalid_pending_id" });
    return;
  }
  const decision = ApplyDecisionSchema.safeParse(req.body);
  if (!decision.success) {
    res.status(400).json({ error: "invalid_input", details: decision.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName);
  const PendingUpload = getPendingUploadModel(conn);
  const PendingUploadRows = getPendingUploadRowsModel(conn);

  const pending = await PendingUpload.findById(pendingId).lean();
  if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
    res.status(404).json({ error: "pending_upload_not_found" });
    return;
  }

  // Staged SQL dumps are all-or-nothing: the only decisions are approve
  // (apply every table exactly as summarized) or cancel.
  if (Array.isArray(pending.plans) && pending.plans.length > 0) {
    if (decision.data.mode !== "apply-plan" || decision.data.fieldOverrides?.length) {
      res.status(400).json({ error: "sql_dump_decision_unsupported" });
      return;
    }
    const stagedPlans = pending.plans as ExtractionPlan[];
    const strategy = decision.data.sqlCollisionStrategy ?? "suffix";

    // Resolve name collisions against the CURRENT collections under the
    // user's strategy: "replace" updates existing collections by primary key
    // (falling back to a suffixed copy when the table has no key), "suffix"
    // always imports numbered copies. FK relations are remapped to whatever
    // final names the tables end up with.
    const MetaCollectionForSql = getMetaCollectionModel(conn);
    const currentNames = new Set(
      (await MetaCollectionForSql.find().select("name").lean()).map((c) => String(c.name)),
    );
    const takenNames = [...currentNames];
    const finalNameByBase = new Map<string, string>();
    for (const staged of stagedPlans) {
      const base = staged.targetCollection;
      const collides = currentNames.has(base);
      const updatable = collides && strategy === "replace" && staged.upsertKey !== null;
      const finalName =
        !collides || updatable ? base : dedupeCollectionName(base, takenNames);
      takenNames.push(finalName);
      finalNameByBase.set(base, finalName);
    }
    const plans: ExtractionPlan[] = stagedPlans.map((staged) => {
      const finalName = finalNameByBase.get(staged.targetCollection)!;
      const updatesExisting = currentNames.has(finalName);
      return {
        ...staged,
        action: updatesExisting ? "replace" : "create",
        targetCollection: finalName,
        relations: staged.relations.map((relation) => ({
          ...relation,
          toCollection: finalNameByBase.get(relation.toCollection) ?? relation.toCollection,
        })),
      };
    });

    const newCollectionCount = plans.filter((plan) => plan.action === "create").length;
    if (currentNames.size + newCollectionCount > FREE_COLLECTION_LIMIT) {
      res.status(409).json({ error: "collection_limit_reached", limit: FREE_COLLECTION_LIMIT });
      return;
    }

    const chunks = await PendingUploadRows.find({ pendingId: pending._id })
      .sort({ tableIndex: 1, seq: 1 })
      .lean();
    const sourceFile = pending.sourceFile as {
      originalName: string;
      mimetype: string;
      sizeBytes: number;
    };
    const results: CollectionWriteResult[] = [];
    for (let tableIndex = 0; tableIndex < plans.length; tableIndex++) {
      const rows = chunks
        .filter((chunk) => (chunk.tableIndex ?? 0) === tableIndex)
        .flatMap((chunk) => chunk.rows as Record<string, unknown>[]);
      results.push(
        await applyExtractionPlan(
          conn,
          plans[tableIndex],
          rows,
          sourceFile,
          (pending.instruction as string | null) ?? null,
        ),
      );
    }

    await PendingUploadRows.deleteMany({ pendingId: pending._id });
    await PendingUpload.deleteOne({ _id: pending._id });
    await markRateLimitSuccess(req.userDbName, "upload");

    const totalInserted = results.reduce((sum, result) => sum + result.insertedCount, 0);
    logActivity(
      conn,
      "document-upload",
      `Uploaded "${sourceFile.originalName}" → ${results.length} collection${results.length === 1 ? "" : "s"} (${totalInserted} rows)`,
      { collections: results.map((result) => result.collectionName), action: "create" },
    );

    // Aggregate `collection` keeps the single-collection applied contract the
    // queue/notification UI renders; the per-table breakdown rides alongside.
    const names = results.map((result) => result.displayName);
    const aggregateDisplayName =
      results.length === 1
        ? results[0].displayName
        : `${results.length} collections (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})`;
    res.status(200).json({
      status: "applied" as const,
      plan: plans[0],
      collection: {
        collectionName: results[0].collectionName,
        displayName: aggregateDisplayName,
        rowCount: totalInserted,
        insertedCount: totalInserted,
        updatedCount: 0,
        skippedDuplicateCount: 0,
        rowsMissingKey: 0,
      },
      collections: results,
      similarityNote: null,
      similarCollections: [],
    });
    return;
  }

  let plan = pending.plan as ExtractionPlan;
  let duplicateStrategy: "skip" | "overwrite" | undefined;

  const MetaCollection = getMetaCollectionModel(conn);

  switch (decision.data.mode) {
    case "apply-plan":
      break;
    case "create-new": {
      const existingNames = (await MetaCollection.find().select("name").lean()).map(
        (c) => c.name,
      );
      plan = {
        ...plan,
        action: "create",
        targetCollection: dedupeCollectionName(plan.targetCollection, existingNames),
      };
      break;
    }
    case "merge-into": {
      const target = await MetaCollection.findOne({
        name: decision.data.targetCollection,
      }).lean();
      if (!target) {
        // e.g. the collection was deleted while the decision sat open.
        res.status(409).json({ error: "target_collection_not_found" });
        return;
      }
      plan = {
        ...plan,
        action: "merge",
        targetCollection: target.name,
        displayName: target.displayName,
      };
      duplicateStrategy = decision.data.duplicateStrategy;
      break;
    }
  }

  const targetExists = await MetaCollection.exists({ name: plan.targetCollection });
  if (!targetExists && (await MetaCollection.countDocuments()) >= FREE_COLLECTION_LIMIT) {
    res.status(409).json({ error: "collection_limit_reached", limit: FREE_COLLECTION_LIMIT });
    return;
  }

  const chunks = await PendingUploadRows.find({ pendingId: pending._id })
    .sort({ seq: 1 })
    .lean();
  let rows = chunks.flatMap((chunk) => chunk.rows as Record<string, unknown>[]);

  // Pre-write schema edits (rename/retype) — create-flavored modes only.
  if (decision.data.mode !== "merge-into" && decision.data.fieldOverrides?.length) {
    const overridden = applyFieldOverrides(plan, rows, decision.data.fieldOverrides);
    if ("error" in overridden) {
      res.status(400).json({ error: "invalid_field_overrides", details: overridden.error });
      return;
    }
    plan = overridden.plan;
    rows = overridden.rows;
  }

  const collection = await applyExtractionPlan(
    conn,
    plan,
    rows,
    pending.sourceFile as { originalName: string; mimetype: string; sizeBytes: number },
    (pending.instruction as string | null) ?? null,
    { duplicateStrategy },
  );

  await PendingUploadRows.deleteMany({ pendingId: pending._id });
  await PendingUpload.deleteOne({ _id: pending._id });
  await markRateLimitSuccess(req.userDbName, "upload");
  logActivity(
    conn,
    "document-upload",
    `Uploaded "${(pending.sourceFile as { originalName: string }).originalName}" → ${collection.displayName}${writeStatsSummary(collection)}`,
    { collection: collection.collectionName, action: plan.action, decision: decision.data.mode },
  );

  res
    .status(200)
    .json(appliedResponse(plan, collection, pending.similarCollections as SimilarityCandidate[]));
}

export async function cancelUpload(req: Request, res: Response) {
  if (!req.userDbName) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const pendingId = String(req.params.pendingId);
  if (!mongoose.Types.ObjectId.isValid(pendingId)) {
    res.status(400).json({ error: "invalid_pending_id" });
    return;
  }

  const conn = getUserConnection(req.userDbName);
  // Idempotent: canceling an already-expired/removed pending upload is fine.
  const pending = await getPendingUploadModel(conn).findById(pendingId).lean();
  await getPendingUploadRowsModel(conn).deleteMany({
    pendingId: new mongoose.Types.ObjectId(pendingId),
  });
  await getPendingUploadModel(conn).deleteOne({ _id: pendingId });

  if (pending) {
    logActivity(
      conn,
      "document-skip",
      `Skipped upload "${(pending.sourceFile as { originalName: string }).originalName}"`,
    );
  }

  res.status(200).json({ ok: true });
}
