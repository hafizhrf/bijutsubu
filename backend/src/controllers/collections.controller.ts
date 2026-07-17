import { Request, Response } from "express";
import mongoose, { Connection } from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { getMetaCustomTableModel } from "../models/metaCustomTable.model.js";
import { updateRelationsFromPrompt } from "../services/relationManager.service.js";
import { guardIntent } from "../services/genUI.intentGuard.service.js";
import { generateCustomTable } from "../services/customTable.service.js";
import {
  findQueryDslSafetyViolations,
  validateStandaloneQuery,
} from "../services/genUI.specValidator.service.js";
import type { CollectionShape, RelationShape } from "../services/genUI.specValidator.service.js";
import { assertWhitelisted, buildPipeline } from "../services/genUI.pipelineBuilder.service.js";
import { QueryDSLSchema } from "../schemas/uiSpec.schema.js";
import { parseExportFormat, sendRowsExport } from "../services/rowExporter.util.js";
import { markRateLimitSuccess } from "../middleware/rateLimit.js";
import { logActivity } from "../services/activityLog.service.js";

export async function listCollections(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const MetaCollection = getMetaCollectionModel(conn);
  const collections = await MetaCollection.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ collections });
}

export async function sampleCollection(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const MetaCollection = getMetaCollectionModel(conn);

  const name = String(req.params.name);
  const limitParam = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 200);

  const meta = await MetaCollection.findOne({ name }).lean();
  if (!meta) {
    res.status(404).json({ error: "collection_not_found" });
    return;
  }

  const rows = await conn.collection(name).find().limit(limit).toArray();
  res.status(200).json({ fields: meta.fields, rows });
}

export async function listRelations(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const MetaRelation = getMetaRelationModel(conn);
  const relations = await MetaRelation.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ relations });
}

const CustomTablePromptSchema = z.object({ prompt: z.string().min(1).max(2000) });

/** NL → single custom data table (same guarded, DSL-constrained path as genUI). */
export async function customTableQuery(req: Request, res: Response) {
  const parsed = CustomTablePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { prompt } = parsed.data;

  const guard = await guardIntent(prompt);
  if (!guard.allowed) {
    res.status(400).json({ rejected: true, reason: guard.reasonForUser, category: guard.category });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const result = await generateCustomTable(conn, prompt);

  await markRateLimitSuccess(req.userDbName!, "genui");

  res.status(200).json(result);
}

// ---- Saved custom tables ----

async function loadShapes(conn: Connection): Promise<{
  collections: CollectionShape[];
  relations: RelationShape[];
}> {
  const [collections, relations] = await Promise.all([
    getMetaCollectionModel(conn).find().lean(),
    getMetaRelationModel(conn).find().lean(),
  ]);
  return {
    collections: collections.map((c) => ({
      name: c.name,
      fields: c.fields.map((f: { name: string; type: string }) => ({ name: f.name, type: f.type })),
    })),
    relations: relations.map((r) => ({
      fromCollection: r.fromCollection,
      toCollection: r.toCollection,
    })),
  };
}

const SaveCustomTableSchema = z.object({
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(2000),
  title: z.string().min(1).max(200),
  columns: z
    .array(z.object({ field: z.string().min(1), label: z.string().min(1) }))
    .min(1)
    .max(12),
  query: QueryDSLSchema,
});

/**
 * Persists an NL custom table for reuse. The DSL round-trips through the
 * client here, which makes this a trust boundary the generate path doesn't
 * have: re-validate shape (Zod), key safety ($-prefix/dotted aliases —
 * buildPipeline uses these strings as Mongo object keys), and grounding
 * against current meta before anything is stored. No rate limit — no LLM.
 */
export async function saveCustomTable(req: Request, res: Response) {
  const parsed = SaveCustomTableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { name, prompt, title, columns, query } = parsed.data;

  const safetyViolations = findQueryDslSafetyViolations(query);
  if (safetyViolations.length > 0) {
    res.status(400).json({ error: "unsafe_query", details: safetyViolations });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const shapes = await loadShapes(conn);
  const groundingErrors = validateStandaloneQuery(query, shapes.collections, shapes.relations);
  if (groundingErrors.length > 0) {
    res.status(400).json({ error: "invalid_query", details: groundingErrors });
    return;
  }

  const MetaCustomTable = getMetaCustomTableModel(conn);
  const saved = await MetaCustomTable.create({ name: name.trim(), prompt, title, columns, queryDsl: query });
  logActivity(conn, "custom-table-save", `Saved custom table "${saved.name}"`, {
    customTableId: String(saved._id),
  });
  res.status(201).json({
    customTable: { _id: saved._id, name: saved.name, prompt: saved.prompt, createdAt: saved.createdAt },
  });
}

export async function listCustomTables(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const tables = await getMetaCustomTableModel(conn)
    .find()
    .select("_id name prompt title createdAt")
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json({ customTables: tables });
}

async function findCustomTableOr404(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "custom_table_not_found" });
    return null;
  }
  const conn = getUserConnection(req.userDbName!);
  const table = await getMetaCustomTableModel(conn).findById(id).lean();
  if (!table) {
    res.status(404).json({ error: "custom_table_not_found" });
    return null;
  }
  return { conn, table };
}

/** Executes a saved table's stored DSL against current data (rows are never stored). */
async function executeSavedTable(
  conn: Connection,
  table: { queryDsl: unknown },
): Promise<Record<string, unknown>[]> {
  const query = QueryDSLSchema.parse(table.queryDsl);
  const known = new Set(
    (await getMetaCollectionModel(conn).find().select("name").lean()).map((c) => c.name),
  );
  if (!known.has(query.collection)) return [];
  for (const join of query.joins) {
    if (!known.has(join.collection)) {
      throw new Error(`Saved table joins a collection that no longer exists: ${join.collection}`);
    }
  }
  const pipeline = buildPipeline(query);
  assertWhitelisted(pipeline);
  const rows = await conn
    .collection(query.collection)
    .aggregate(pipeline, { allowDiskUse: false })
    .toArray();
  return rows as Record<string, unknown>[];
}

export async function getCustomTable(req: Request, res: Response) {
  const found = await findCustomTableOr404(req, res);
  if (!found) return;
  const { conn, table } = found;
  const rows = await executeSavedTable(conn, table);
  res.status(200).json({
    _id: table._id,
    name: table.name,
    prompt: table.prompt,
    title: table.title,
    columns: table.columns,
    createdAt: table.createdAt,
    rows,
  });
}

const RenameCustomTableSchema = z.object({ name: z.string().min(1).max(120) });

export async function renameCustomTable(req: Request, res: Response) {
  const parsed = RenameCustomTableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const found = await findCustomTableOr404(req, res);
  if (!found) return;
  const { conn, table } = found;
  await getMetaCustomTableModel(conn).updateOne(
    { _id: table._id },
    { $set: { name: parsed.data.name.trim() } },
  );
  logActivity(conn, "custom-table-rename", `Renamed a custom table to "${parsed.data.name.trim()}"`);
  res.status(200).json({ ok: true, name: parsed.data.name.trim() });
}

export async function deleteCustomTable(req: Request, res: Response) {
  const found = await findCustomTableOr404(req, res);
  if (!found) return;
  const { conn, table } = found;
  await getMetaCustomTableModel(conn).deleteOne({ _id: table._id });
  logActivity(conn, "custom-table-delete", `Deleted custom table "${table.name}"`);
  res.status(200).json({ ok: true });
}

export async function exportCustomTable(req: Request, res: Response) {
  const found = await findCustomTableOr404(req, res);
  if (!found) return;
  const { conn, table } = found;
  const rows = await executeSavedTable(conn, table);
  const columns = table.columns as { field: string; label: string }[];
  sendRowsExport(
    res,
    parseExportFormat(req.query.format),
    table.name,
    columns.map((column) => column.field),
    rows,
  );
}

const RelationPromptSchema = z.object({ prompt: z.string().min(1).max(2000) });

export async function updateRelations(req: Request, res: Response) {
  const parsed = RelationPromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaRelation = getMetaRelationModel(conn);

  const { update } = await updateRelationsFromPrompt(conn, parsed.data.prompt);
  const relations = await MetaRelation.find().sort({ createdAt: -1 }).lean();
  logActivity(
    conn,
    "relation-prompt",
    `Relations updated via prompt: ${update.summary.slice(0, 240)}`,
    { operations: update.operations.length },
  );

  res.status(200).json({ relations, changes: update });
}
