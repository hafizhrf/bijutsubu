import { Request, Response } from "express";
import mongoose, { Connection } from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { getMetaDashboardModel } from "../models/metaDashboard.model.js";
import { logActivity } from "../services/activityLog.service.js";
import { coerceValueToDate } from "../services/dateNormalizer.util.js";
import { parseExportFormat, sendRowsExport } from "../services/rowExporter.util.js";
import { FIELD_NAME_PATTERN, FieldTypeEnum } from "../schemas/fieldCommon.js";

/**
 * Rejects any key starting with "$" or containing "." anywhere in the object
 * tree, so client-supplied row data can never smuggle Mongo operators.
 */
function hasUnsafeKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeKeys);
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".")) return true;
      if (hasUnsafeKeys(nested)) return true;
    }
  }
  return false;
}

async function getMetaOr404(conn: Connection, name: string, res: Response) {
  const MetaCollection = getMetaCollectionModel(conn);
  const meta = await MetaCollection.findOne({ name }).lean();
  if (!meta) {
    res.status(404).json({ error: "collection_not_found" });
    return null;
  }
  return meta;
}

/**
 * Manual row edits send every value as JSON (dates arrive as strings); convert
 * strings on date-typed fields to real Dates so columns stay uniformly typed
 * with upload-ingested rows. Unparseable values are stored as-is.
 */
function coerceDateFields(
  values: Record<string, unknown>,
  fields: { name: string; type: string }[],
): Record<string, unknown> {
  const dateFields = new Set(fields.filter((f) => f.type === "date").map((f) => f.name));
  const out = { ...values };
  for (const [key, value] of Object.entries(out)) {
    if (!dateFields.has(key) || typeof value !== "string" || value === "") continue;
    const parsed = coerceValueToDate(value);
    if (parsed) out[key] = parsed;
  }
  return out;
}

async function refreshRowCount(conn: Connection, name: string) {
  const rowCount = await conn.collection(name).countDocuments();
  await getMetaCollectionModel(conn).updateOne({ name }, { $set: { rowCount } });
  return rowCount;
}

// ---- Rows ----

/**
 * Free-text search filter: case-insensitive substring over string/date fields,
 * plus exact value on number fields when the term parses as a number. Field
 * names come from server-stored meta (never client input) and the term is
 * regex-escaped.
 */
function buildSearchFilter(
  fields: { name: string; type: string }[],
  search: string,
): Record<string, unknown> {
  if (!search) return {};
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clauses: Record<string, unknown>[] = [];
  for (const field of fields) {
    if (field.type === "string" || field.type === "date") {
      clauses.push({ [field.name]: { $regex: escaped, $options: "i" } });
    }
  }
  const numeric = Number(search);
  if (!Number.isNaN(numeric)) {
    for (const field of fields) {
      if (field.type === "number") clauses.push({ [field.name]: numeric });
    }
  }
  return clauses.length > 0 ? { $or: clauses } : { _id: { $in: [] } };
}

const ColumnFilterOpEnum = z.enum(["eq", "ne", "contains", "gt", "gte", "lt", "lte"]);

const ColumnFiltersSchema = z
  .array(
    z.object({
      field: z.string().min(1).max(80),
      op: ColumnFilterOpEnum,
      value: z.union([z.string().max(500), z.number(), z.boolean()]),
    }),
  )
  .max(10);

const FILTERS_PARAM_MAX_BYTES = 4_096;

const COLUMN_FILTER_OP_MAP: Record<string, string> = {
  ne: "$ne",
  gt: "$gt",
  gte: "$gte",
  lt: "$lt",
  lte: "$lte",
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Per-column filters from the ?filters JSON param. Every field name is
 * validated against server-stored meta before it becomes a Mongo key — that
 * whitelist, not escaping, is the injection defense. Values are coerced by
 * the field's declared type. Returns null on any invalid input (→ 400).
 */
function buildColumnFilters(
  fields: { name: string; type: string }[],
  rawParam: unknown,
): Record<string, unknown>[] | null {
  if (typeof rawParam !== "string" || rawParam.trim() === "") return [];
  if (rawParam.length > FILTERS_PARAM_MAX_BYTES) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawParam);
  } catch {
    return null;
  }
  const parsed = ColumnFiltersSchema.safeParse(parsedJson);
  if (!parsed.success) return null;

  const byName = new Map(fields.map((f) => [f.name, f]));
  const clauses: Record<string, unknown>[] = [];

  for (const filter of parsed.data) {
    const field = byName.get(filter.field);
    if (!field) return null; // unknown column — reject the whole request

    let value: unknown = filter.value;
    if (field.type === "number" && typeof value !== "number") {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) return null;
      value = numeric;
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      value = String(value).toLowerCase() === "true";
    } else if (field.type === "date" && typeof value === "string") {
      const parsedDate = coerceValueToDate(value);
      if (!parsedDate) return null;
      value = parsedDate;
    }

    if (filter.op === "contains") {
      clauses.push({ [field.name]: { $regex: escapeRegex(String(filter.value)), $options: "i" } });
    } else if (filter.op === "eq" && field.type === "string") {
      clauses.push({
        [field.name]: { $regex: `^${escapeRegex(String(filter.value))}$`, $options: "i" },
      });
    } else if (filter.op === "eq") {
      clauses.push({ [field.name]: value });
    } else if (filter.op === "ne" && field.type === "string") {
      clauses.push({
        [field.name]: { $not: { $regex: `^${escapeRegex(String(filter.value))}$`, $options: "i" } },
      });
    } else {
      clauses.push({ [field.name]: { [COLUMN_FILTER_OP_MAP[filter.op]]: value } });
    }
  }
  return clauses;
}

/** AND-merges the free-text search $or with per-column filter clauses. */
function combineFilters(
  searchFilter: Record<string, unknown>,
  columnClauses: Record<string, unknown>[],
): Record<string, unknown> {
  const parts = [
    ...(Object.keys(searchFilter).length > 0 ? [searchFilter] : []),
    ...columnClauses,
  ];
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

/**
 * Sort spec from ?sort/?sortDir: only "_id" or a server-declared field name
 * is accepted; anything else is ignored. A trailing _id tiebreaker keeps
 * pagination stable under duplicate sort values.
 */
function buildSortSpec(
  fields: { name: string }[],
  rawSort: unknown,
  rawDir: unknown,
): Record<string, 1 | -1> | null {
  if (typeof rawSort !== "string" || rawSort === "") return null;
  const valid = rawSort === "_id" || fields.some((f) => f.name === rawSort);
  if (!valid) return null;
  const dir: 1 | -1 = rawDir === "desc" ? -1 : 1;
  return rawSort === "_id" ? { _id: dir } : { [rawSort]: dir, _id: 1 };
}

export async function listRows(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const skip = Math.max(Number(typeof req.query.skip === "string" ? req.query.skip : 0) || 0, 0);
  const limitRaw = Number(typeof req.query.limit === "string" ? req.query.limit : 50) || 50;
  const limit = Math.min(Math.max(limitRaw, 1), 200);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const fields = meta.fields as { name: string; type: string }[];

  const columnClauses = buildColumnFilters(fields, req.query.filters);
  if (columnClauses === null) {
    res.status(400).json({ error: "invalid_filters" });
    return;
  }
  const filter = combineFilters(buildSearchFilter(fields, search), columnClauses);
  const sort = buildSortSpec(fields, req.query.sort, req.query.sortDir);

  const collection = conn.collection(name);
  let cursor = collection.find(filter);
  if (sort) cursor = cursor.sort(sort);
  const [rows, total] = await Promise.all([
    cursor.skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  res.status(200).json({ fields: meta.fields, rows, total, skip, limit });
}

const EXPORT_MAX_ROWS = 100_000;

/**
 * Export of a whole collection as csv (default), xlsx, or json — honoring the
 * same optional ?search, ?filters, and ?sort params as listRows so the file
 * matches the grid view.
 */
export async function exportRows(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const fields = meta.fields as { name: string; type: string }[];
  const columnClauses = buildColumnFilters(fields, req.query.filters);
  if (columnClauses === null) {
    res.status(400).json({ error: "invalid_filters" });
    return;
  }
  const filter = combineFilters(buildSearchFilter(fields, search), columnClauses);
  const sort = buildSortSpec(fields, req.query.sort, req.query.sortDir);

  let cursor = conn.collection(name).find(filter);
  if (sort) cursor = cursor.sort(sort);
  const rows = await cursor.limit(EXPORT_MAX_ROWS).toArray();

  const fieldNames = ["_id", ...fields.map((field) => field.name)];
  sendRowsExport(
    res,
    parseExportFormat(req.query.format),
    name,
    fieldNames,
    rows as Record<string, unknown>[],
  );
}

const RowBodySchema = z.object({ row: z.record(z.string(), z.unknown()) });

export async function insertRow(req: Request, res: Response) {
  const parsed = RowBodySchema.safeParse(req.body);
  if (!parsed.success || hasUnsafeKeys(parsed.data.row)) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const row = coerceDateFields(
    parsed.data.row,
    meta.fields as { name: string; type: string }[],
  );
  delete row._id;

  const result = await conn.collection(name).insertOne(row);
  const total = await refreshRowCount(conn, name);
  logActivity(conn, "row-insert", `Added a row to ${meta.displayName}`, { collection: name });

  res.status(201).json({ row: { _id: result.insertedId, ...row }, total });
}

const RowPatchSchema = z.object({ set: z.record(z.string(), z.unknown()) });

export async function updateRow(req: Request, res: Response) {
  const parsed = RowPatchSchema.safeParse(req.body);
  if (!parsed.success || hasUnsafeKeys(parsed.data.set)) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const rowId = String(req.params.rowId);
  if (!mongoose.Types.ObjectId.isValid(rowId)) {
    res.status(400).json({ error: "invalid_row_id" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const set = coerceDateFields(
    parsed.data.set,
    meta.fields as { name: string; type: string }[],
  );
  delete set._id;
  if (Object.keys(set).length === 0) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const result = await conn
    .collection(name)
    .updateOne({ _id: new mongoose.Types.ObjectId(rowId) }, { $set: set });

  if (result.matchedCount === 0) {
    res.status(404).json({ error: "row_not_found" });
    return;
  }
  logActivity(conn, "row-update", `Edited a row in ${meta.displayName}`, { collection: name });
  res.status(200).json({ ok: true });
}

const BulkDeleteSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});

export async function deleteRows(req: Request, res: Response) {
  const parsed = BulkDeleteSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const objectIds = parsed.data.ids.map((id) => new mongoose.Types.ObjectId(id));
  const result = await conn.collection(name).deleteMany({ _id: { $in: objectIds } });
  const total = await refreshRowCount(conn, name);
  logActivity(
    conn,
    "row-delete",
    `Deleted ${result.deletedCount} row${result.deletedCount === 1 ? "" : "s"} from ${meta.displayName}`,
    { collection: name },
  );

  res.status(200).json({ ok: true, deleted: result.deletedCount, total });
}

export async function deleteRow(req: Request, res: Response) {
  const rowId = String(req.params.rowId);
  if (!mongoose.Types.ObjectId.isValid(rowId)) {
    res.status(400).json({ error: "invalid_row_id" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const result = await conn
    .collection(name)
    .deleteOne({ _id: new mongoose.Types.ObjectId(rowId) });

  if (result.deletedCount === 0) {
    res.status(404).json({ error: "row_not_found" });
    return;
  }
  const total = await refreshRowCount(conn, name);
  logActivity(conn, "row-delete", `Deleted a row from ${meta.displayName}`, { collection: name });
  res.status(200).json({ ok: true, total });
}

// ---- Fields ----

const AddFieldSchema = z.object({
  name: z.string().regex(FIELD_NAME_PATTERN),
  type: FieldTypeEnum,
  nullable: z.boolean().default(true),
});

export async function addField(req: Request, res: Response) {
  const parsed = AddFieldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  if (meta.fields.some((f: { name: string }) => f.name === parsed.data.name)) {
    res.status(409).json({ error: "field_already_exists" });
    return;
  }

  const MetaCollection = getMetaCollectionModel(conn);
  await MetaCollection.updateOne({ name }, { $push: { fields: parsed.data } });
  await conn.collection(name).updateMany({}, { $set: { [parsed.data.name]: null } });
  logActivity(
    conn,
    "field-add",
    `Added field "${parsed.data.name}" (${parsed.data.type}) to ${meta.displayName}`,
    { collection: name },
  );

  res.status(201).json({ field: parsed.data });
}

const UpdateFieldSchema = z
  .object({
    newName: z.string().regex(FIELD_NAME_PATTERN).optional(),
    type: FieldTypeEnum.optional(),
    nullable: z.boolean().optional(),
  })
  .refine((v) => v.newName !== undefined || v.type !== undefined || v.nullable !== undefined, {
    message: "nothing to update",
  });

export async function updateField(req: Request, res: Response) {
  const parsed = UpdateFieldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const fieldName = String(req.params.field);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const field = meta.fields.find((f: { name: string }) => f.name === fieldName);
  if (!field) {
    res.status(404).json({ error: "field_not_found" });
    return;
  }

  const { newName, type, nullable } = parsed.data;

  if (newName && newName !== fieldName) {
    if (meta.fields.some((f: { name: string }) => f.name === newName)) {
      res.status(409).json({ error: "field_already_exists" });
      return;
    }
    await conn.collection(name).updateMany({}, { $rename: { [fieldName]: newName } });
  }

  const MetaCollection = getMetaCollectionModel(conn);
  await MetaCollection.updateOne(
    { name, "fields.name": fieldName },
    {
      $set: {
        "fields.$.name": newName ?? fieldName,
        ...(type !== undefined ? { "fields.$.type": type } : {}),
        ...(nullable !== undefined ? { "fields.$.nullable": nullable } : {}),
        // The unique-key setting tracks the field through renames.
        ...(newName && meta.upsertKey === fieldName ? { upsertKey: newName } : {}),
      },
    },
  );
  logActivity(
    conn,
    "field-update",
    newName && newName !== fieldName
      ? `Renamed field "${fieldName}" to "${newName}" on ${meta.displayName}`
      : `Edited field "${fieldName}" on ${meta.displayName}`,
    { collection: name },
  );

  res.status(200).json({ ok: true });
}

export async function deleteField(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const fieldName = String(req.params.field);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  if (!meta.fields.some((f: { name: string }) => f.name === fieldName)) {
    res.status(404).json({ error: "field_not_found" });
    return;
  }

  await conn.collection(name).updateMany({}, { $unset: { [fieldName]: "" } });
  const MetaCollection = getMetaCollectionModel(conn);
  await MetaCollection.updateOne(
    { name },
    {
      $pull: { fields: { name: fieldName } },
      ...(meta.upsertKey === fieldName ? { $set: { upsertKey: null } } : {}),
    },
  );
  logActivity(
    conn,
    "field-delete",
    `Deleted field "${fieldName}" from ${meta.displayName}`,
    { collection: name },
  );

  res.status(200).json({ ok: true });
}

// ---- Collection properties ----

const UpdateCollectionSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    // upsertKey is the collection's unique field: uploads can skip/merge
    // duplicate rows keyed on it. null clears the setting.
    upsertKey: z.string().nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.upsertKey !== undefined, {
    message: "nothing to update",
  });

export async function updateCollection(req: Request, res: Response) {
  const parsed = UpdateCollectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const { displayName, upsertKey } = parsed.data;
  if (
    typeof upsertKey === "string" &&
    !meta.fields.some((f: { name: string }) => f.name === upsertKey)
  ) {
    res.status(400).json({ error: "unknown_field" });
    return;
  }

  await getMetaCollectionModel(conn).updateOne(
    { name },
    {
      $set: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(upsertKey !== undefined ? { upsertKey } : {}),
      },
    },
  );
  const changes: string[] = [];
  if (displayName !== undefined) changes.push(`renamed to "${displayName}"`);
  if (upsertKey !== undefined) {
    changes.push(upsertKey ? `unique field set to "${upsertKey}"` : "unique field cleared");
  }
  logActivity(
    conn,
    "collection-update",
    `Updated ${meta.displayName}: ${changes.join(", ")}`,
    { collection: name },
  );
  res.status(200).json({ ok: true });
}

/** True when any widget of a saved dashboard queries or joins `name`. */
function specReferencesCollection(uiSpec: unknown, name: string): boolean {
  const widgets = (
    uiSpec as { widgets?: { query?: { collection?: string; joins?: { collection?: string }[] } }[] }
  )?.widgets;
  if (!Array.isArray(widgets)) return false;
  return widgets.some(
    (widget) =>
      widget?.query?.collection === name ||
      (Array.isArray(widget?.query?.joins) &&
        widget.query.joins.some((join) => join?.collection === name)),
  );
}

/**
 * What breaks if this collection is deleted: relations that involve it and
 * saved dashboards whose widgets query/join it. Powers the delete-confirm UI.
 */
export async function getCollectionDependencies(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const relations = await getMetaRelationModel(conn)
    .find({ $or: [{ fromCollection: name }, { toCollection: name }] })
    .lean();
  const collections = await getMetaCollectionModel(conn)
    .find()
    .select({ name: 1, displayName: 1 })
    .lean();
  const displayNames = Object.fromEntries(collections.map((c) => [c.name, c.displayName]));

  const dashboards = await getMetaDashboardModel(conn)
    .find()
    .select({ title: 1, uiSpec: 1 })
    .lean();
  const referencedBy = dashboards
    .filter((dashboard) => specReferencesCollection(dashboard.uiSpec, name))
    .map((dashboard) => ({ _id: String(dashboard._id), title: dashboard.title }));

  res.status(200).json({
    relations: relations.map((relation) => {
      const other =
        relation.fromCollection === name ? relation.toCollection : relation.fromCollection;
      return {
        _id: String(relation._id),
        fromCollection: relation.fromCollection,
        toCollection: relation.toCollection,
        fromField: relation.fromField,
        toField: relation.toField,
        type: relation.type,
        counterpart: other,
        counterpartDisplayName: displayNames[other] ?? other,
      };
    }),
    dashboards: referencedBy,
  });
}

const RowDependenciesSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

/** Widens a key value for type-tolerant matching (string hex ids vs ObjectId). */
function keyCandidates(value: unknown): unknown[] {
  const out: unknown[] = [value];
  const text = String(value);
  if (text !== value) out.push(text);
  if (mongoose.Types.ObjectId.isValid(text) && /^[a-f0-9]{24}$/.test(text)) {
    out.push(new mongoose.Types.ObjectId(text));
  }
  return out;
}

/**
 * Counts rows in OTHER collections that reference the given rows through an
 * inbound relation (relation.toCollection === this collection). Outbound
 * references die with the row, so only inbound ones warrant a warning.
 */
export async function getRowDependencies(req: Request, res: Response) {
  const parsed = RowDependenciesSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  const objectIds = parsed.data.ids.map((id) => new mongoose.Types.ObjectId(id));
  const inbound = await getMetaRelationModel(conn).find({ toCollection: name }).lean();
  const collections = await getMetaCollectionModel(conn)
    .find()
    .select({ name: 1, displayName: 1 })
    .lean();
  const displayNames = Object.fromEntries(collections.map((c) => [c.name, c.displayName]));

  const dependents: {
    collection: string;
    displayName: string;
    field: string;
    type: string;
    count: number;
  }[] = [];

  for (const relation of inbound) {
    let keyValues: unknown[];
    if (relation.toField === "_id") {
      keyValues = objectIds;
    } else {
      const rows = await conn
        .collection(name)
        .find({ _id: { $in: objectIds } })
        .project({ [relation.toField]: 1, _id: 0 })
        .toArray();
      keyValues = rows
        .map((row) => (row as Record<string, unknown>)[relation.toField])
        .filter((value) => value !== null && value !== undefined && value !== "");
    }
    if (keyValues.length === 0) continue;

    const candidates = keyValues.flatMap(keyCandidates);
    const count = await conn
      .collection(relation.fromCollection)
      .countDocuments({ [relation.fromField]: { $in: candidates } });
    if (count > 0) {
      dependents.push({
        collection: relation.fromCollection,
        displayName: displayNames[relation.fromCollection] ?? relation.fromCollection,
        field: relation.fromField,
        type: relation.type,
        count,
      });
    }
  }

  res.status(200).json({ dependents });
}

export async function deleteCollection(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const name = String(req.params.name);
  const meta = await getMetaOr404(conn, name, res);
  if (!meta) return;

  try {
    await conn.dropCollection(name);
  } catch {
    // Collection may have no physical presence yet (zero inserts) — meta cleanup still applies.
  }
  await getMetaCollectionModel(conn).deleteOne({ name });
  await getMetaRelationModel(conn).deleteMany({
    $or: [{ fromCollection: name }, { toCollection: name }],
  });
  logActivity(
    conn,
    "collection-delete",
    `Deleted collection ${meta.displayName} (${meta.rowCount} rows)`,
    { collection: name },
  );

  res.status(200).json({ ok: true });
}

// ---- Relations (direct CRUD, complementing the NL-prompt endpoint) ----

const RelationTypeEnum = z.enum(["one-to-one", "one-to-many", "many-to-many"]);

const CreateRelationSchema = z.object({
  fromCollection: z.string().min(1),
  toCollection: z.string().min(1),
  fromField: z.string().min(1),
  toField: z.string().min(1),
  type: RelationTypeEnum,
  description: z.string().min(1).max(500).default("Manually created relation"),
});

export async function createRelation(req: Request, res: Response) {
  const parsed = CreateRelationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaCollection = getMetaCollectionModel(conn);
  const names = await MetaCollection.find().select("name").lean();
  const known = new Set(names.map((c) => c.name));
  if (!known.has(parsed.data.fromCollection) || !known.has(parsed.data.toCollection)) {
    res.status(404).json({ error: "collection_not_found" });
    return;
  }

  const MetaRelation = getMetaRelationModel(conn);
  const relation = await MetaRelation.findOneAndUpdate(
    { fromCollection: parsed.data.fromCollection, toCollection: parsed.data.toCollection },
    { $set: { ...parsed.data, createdVia: "manual" } },
    { upsert: true, new: true },
  );
  logActivity(
    conn,
    "relation-create",
    `Linked ${parsed.data.fromCollection}.${parsed.data.fromField} → ${parsed.data.toCollection}.${parsed.data.toField} (${parsed.data.type})`,
  );

  res.status(201).json({ relation });
}

const PatchRelationSchema = z
  .object({
    fromField: z.string().min(1).optional(),
    toField: z.string().min(1).optional(),
    type: RelationTypeEnum.optional(),
    description: z.string().min(1).max(500).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update" });

export async function patchRelation(req: Request, res: Response) {
  const parsed = PatchRelationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_relation_id" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaRelation = getMetaRelationModel(conn);
  const relation = await MetaRelation.findByIdAndUpdate(id, { $set: parsed.data }, { new: true });
  if (!relation) {
    res.status(404).json({ error: "relation_not_found" });
    return;
  }
  logActivity(
    conn,
    "relation-update",
    `Edited relation ${relation.fromCollection}.${relation.fromField} → ${relation.toCollection}.${relation.toField}`,
  );
  res.status(200).json({ relation });
}

export async function deleteRelation(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_relation_id" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const relation = await getMetaRelationModel(conn).findByIdAndDelete(id).lean();
  if (!relation) {
    res.status(404).json({ error: "relation_not_found" });
    return;
  }
  logActivity(
    conn,
    "relation-delete",
    `Removed relation ${relation.fromCollection}.${relation.fromField} → ${relation.toCollection}.${relation.toField}`,
  );
  res.status(200).json({ ok: true });
}
