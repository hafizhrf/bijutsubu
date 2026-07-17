import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { parseDocument } from "../services/documentParser.service.js";
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

  const needsDecision = plan.action !== "create" || similarCollections.length > 0;

  if (!needsDecision) {
    const collection = await applyExtractionPlan(conn, plan, rows, sourceFile, instruction);
    await markRateLimitSuccess(req.userDbName, "upload");
    logActivity(
      conn,
      "document-upload",
      `Uploaded "${sourceFile.originalName}" → ${collection.displayName}${writeStatsSummary(collection)}`,
      { collection: collection.collectionName, action: plan.action },
    );
    res.status(200).json(appliedResponse(plan, collection, similarCollections));
    return;
  }

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
  z.object({ mode: z.literal("apply-plan"), fieldOverrides: FieldOverridesSchema }),
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
