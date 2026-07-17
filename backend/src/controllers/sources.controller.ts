import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaSourceModel } from "../models/metaSource.model.js";
import { dedupeCollectionName } from "../services/extractionPlanner.service.js";
import { encryptCredential } from "../services/credentialVault.util.js";
import { getConnector, sanitizeSourceFieldName, SourceError } from "../services/sources/index.js";
import type { SourceConfig, SourceTableInfo } from "../services/sources/index.js";
import { isSourceSyncRunning, runSourceSync, sourceConfigOf } from "../services/sourceSync.service.js";
import { markRateLimitSuccess } from "../middleware/rateLimit.js";
import { logActivity } from "../services/activityLog.service.js";

/**
 * Connected external database sources (MySQL/MariaDB, PostgreSQL, MongoDB).
 * Security invariants: credentials are encrypted at rest and NEVER returned or
 * logged; connectors are read-only (introspection + escaped SELECT/find); all
 * data lands only in this user's own database via getUserConnection.
 */

const MAX_SOURCES_PER_USER = 5;
const MAX_TABLES_PER_SOURCE = 20;
const FREE_COLLECTION_LIMIT = 20;
const SYNC_INTERVALS = [0, 5, 15, 60] as const;

const ConnectionSchema = z.object({
  engine: z.enum(["mysql", "postgres", "mongodb"]),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1).max(128),
  username: z.string().max(128).default(""),
  password: z.string().max(256).default(""),
  ssl: z.boolean().default(false),
});

const CreateSourceSchema = ConnectionSchema.extend({
  name: z.string().min(1).max(80),
  syncIntervalMinutes: z.coerce
    .number()
    .refine((value) => (SYNC_INTERVALS as readonly number[]).includes(value), "invalid interval"),
  tables: z.array(z.string().min(1).max(128)).min(1).max(MAX_TABLES_PER_SOURCE),
});

const UpdateSourceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  syncIntervalMinutes: z.coerce
    .number()
    .refine((value) => (SYNC_INTERVALS as readonly number[]).includes(value), "invalid interval")
    .optional(),
  /** Credential rotation only — omitted means "keep the stored password". */
  password: z.string().max(256).optional(),
  tables: z.array(z.string().min(1).max(128)).min(1).max(MAX_TABLES_PER_SOURCE).optional(),
});

/** Mirrors the SQL-dump importer's collection naming. */
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

function sourceErrorStatus(code: string): number {
  // A source database rejecting its own credentials must not use 401: the
  // frontend reserves that status for an invalid Bijustubu session and logs
  // the user out globally. This is a valid, authenticated app request with
  // invalid connection input, so report it as an unprocessable request.
  return code === "auth_failed" ? 422 : code === "private_host_blocked" ? 403 : 502;
}

function handleSourceError(res: Response, error: unknown): void {
  if (error instanceof SourceError) {
    res.status(sourceErrorStatus(error.code)).json({ error: error.code });
    return;
  }
  if ((error as Error)?.message === "private_host_blocked") {
    res.status(403).json({ error: "private_host_blocked" });
    return;
  }
  res.status(502).json({ error: "query_failed" });
}

/** Public DTO — encryptedPassword must never leave the server. */
function redact(source: Record<string, unknown>, dbName: string) {
  return {
    _id: String(source._id),
    name: source.name,
    engine: source.engine,
    host: source.host,
    port: source.port,
    database: source.database,
    username: source.username,
    ssl: source.ssl,
    tables: source.tables,
    syncIntervalMinutes: source.syncIntervalMinutes,
    lastSyncAt: source.lastSyncAt,
    lastSyncStatus: source.lastSyncStatus,
    lastSyncError: source.lastSyncError,
    lastSyncStats: source.lastSyncStats,
    createdAt: source.createdAt,
    syncing: isSourceSyncRunning(dbName, String(source._id)),
  };
}

/** Test a connection (and introspect) without saving anything. */
export async function testSource(req: Request, res: Response) {
  const parsed = ConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const config: SourceConfig = parsed.data;
  try {
    const connector = getConnector(config.engine);
    await connector.test(config);
    const tables = await connector.listTables(config);
    res.status(200).json({
      ok: true,
      tables: tables.map((table) => ({
        name: table.name,
        columnCount: table.columns.length,
        pk: table.pk,
        approxRows: table.approxRows,
      })),
    });
  } catch (error) {
    handleSourceError(res, error);
  }
}

export async function createSource(req: Request, res: Response) {
  const parsed = CreateSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const MetaSource = getMetaSourceModel(conn);

  if ((await MetaSource.countDocuments()) >= MAX_SOURCES_PER_USER) {
    res.status(409).json({ error: "source_limit_reached" });
    return;
  }

  const { name, syncIntervalMinutes, tables: requestedTables, ...connection } = parsed.data;
  const collectionCount = await getMetaCollectionModel(conn).countDocuments();
  if (collectionCount + requestedTables.length > FREE_COLLECTION_LIMIT) {
    res.status(409).json({ error: "collection_limit_reached", limit: FREE_COLLECTION_LIMIT });
    return;
  }
  let remoteTables: SourceTableInfo[];
  try {
    remoteTables = await getConnector(connection.engine).listTables(connection);
  } catch (error) {
    handleSourceError(res, error);
    return;
  }
  const remoteByName = new Map(remoteTables.map((table) => [table.name, table]));
  const unknown = requestedTables.filter((table) => !remoteByName.has(table));
  if (unknown.length > 0) {
    res.status(400).json({ error: "unknown_tables", details: unknown });
    return;
  }

  // Reserve target collection names now (deduped against existing workspace
  // collections); the sync's ownership guard protects them afterwards.
  const MetaCollection = getMetaCollectionModel(conn);
  const taken = (await MetaCollection.find().select("name").lean()).map((c) => String(c.name));
  const tables = requestedTables.map((sourceTable) => {
    const target = dedupeCollectionName(sanitizeCollectionName(sourceTable), taken);
    taken.push(target);
    const pk = remoteByName.get(sourceTable)!.pk;
    return {
      sourceTable,
      targetCollection: target,
      upsertKey: pk ? sanitizeSourceFieldName(pk) : null,
      enabled: true,
    };
  });

  const created = await MetaSource.create({
    name,
    ...connection,
    password: undefined,
    encryptedPassword: connection.password ? encryptCredential(connection.password) : "",
    tables,
    syncIntervalMinutes,
  });

  logActivity(conn, "source-connect", `Connected ${connection.engine} source "${name}" (${tables.length} tables)`, {
    sourceId: String(created._id),
    engine: connection.engine,
  });

  // First sync runs in the background; the client polls the list for status.
  const dbName = req.userDbName!;
  void runSourceSync(dbName, conn, created.toObject() as never)?.catch(() => {});

  res.status(201).json({ source: redact(created.toObject(), dbName) });
}

export async function listSources(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const sources = await getMetaSourceModel(conn).find().sort({ createdAt: 1 }).lean();
  res.status(200).json({ sources: sources.map((source) => redact(source, req.userDbName!)) });
}

export async function getSourceTables(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const source = await getMetaSourceModel(conn).findById(id).lean();
  if (!source) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  try {
    const tables = await getConnector(source.engine as SourceConfig["engine"]).listTables(
      sourceConfigOf(source as never),
    );
    res.status(200).json({
      tables: tables.map((table) => ({
        name: table.name,
        columnCount: table.columns.length,
        pk: table.pk,
        approxRows: table.approxRows,
      })),
    });
  } catch (error) {
    handleSourceError(res, error);
  }
}

export async function updateSource(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  const parsed = UpdateSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const MetaSource = getMetaSourceModel(conn);
  const source = await MetaSource.findById(id);
  if (!source) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }

  if (parsed.data.name !== undefined) source.name = parsed.data.name;
  if (parsed.data.syncIntervalMinutes !== undefined) {
    source.syncIntervalMinutes = parsed.data.syncIntervalMinutes;
  }
  if (parsed.data.password !== undefined) {
    source.encryptedPassword = parsed.data.password ? encryptCredential(parsed.data.password) : "";
  }
  if (parsed.data.tables !== undefined) {
    // Keep known mappings (their target collections stay stable); introspect
    // to validate + map any newly added tables.
    interface TableMapping {
      sourceTable: string;
      targetCollection: string;
      upsertKey: string | null;
      enabled: boolean;
    }
    const existingMappings = (source.toObject().tables ?? []) as TableMapping[];
    const byTable = new Map(existingMappings.map((table) => [table.sourceTable, table]));
    const newNames = parsed.data.tables.filter((table) => !byTable.has(table));
    let remoteByName = new Map<string, SourceTableInfo>();
    if (newNames.length > 0) {
      try {
        const remote = await getConnector(source.engine as SourceConfig["engine"]).listTables(
          sourceConfigOf(source.toObject() as never),
        );
        remoteByName = new Map(remote.map((table) => [table.name, table]));
      } catch (error) {
        handleSourceError(res, error);
        return;
      }
      const unknown = newNames.filter((table) => !remoteByName.has(table));
      if (unknown.length > 0) {
        res.status(400).json({ error: "unknown_tables", details: unknown });
        return;
      }
    }
    const MetaCollection = getMetaCollectionModel(conn);
    const taken = (await MetaCollection.find().select("name").lean()).map((c) => String(c.name));
    source.tables = parsed.data.tables.map((sourceTable) => {
      const known = byTable.get(sourceTable);
      if (known) return { ...known, enabled: true };
      const target = dedupeCollectionName(sanitizeCollectionName(sourceTable), taken);
      taken.push(target);
      const pk = remoteByName.get(sourceTable)!.pk;
      return { sourceTable, targetCollection: target, upsertKey: pk ? sanitizeSourceFieldName(pk) : null, enabled: true };
    }) as typeof source.tables;
  }

  await source.save();
  logActivity(conn, "source-update", `Updated source "${source.name}"`, { sourceId: id });
  res.status(200).json({ source: redact(source.toObject(), req.userDbName!) });
}

export async function deleteSource(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const MetaSource = getMetaSourceModel(conn);
  const source = await MetaSource.findById(id).lean();
  if (!source) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  await MetaSource.deleteOne({ _id: id });
  // Synced collections stay in the workspace — just unlink them.
  await getMetaCollectionModel(conn).updateMany(
    { "source.sourceId": id },
    { $set: { source: null } },
  );
  logActivity(conn, "source-delete", `Disconnected source "${source.name}" (collections kept)`, {
    sourceId: id,
  });
  res.status(200).json({ ok: true });
}

export async function syncSourceNow(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const source = await getMetaSourceModel(conn).findById(id).lean();
  if (!source) {
    res.status(404).json({ error: "source_not_found" });
    return;
  }
  if (isSourceSyncRunning(req.userDbName!, id)) {
    res.status(409).json({ error: "sync_already_running" });
    return;
  }

  const result = await runSourceSync(req.userDbName!, conn, source as never);
  if (result === null) {
    res.status(409).json({ error: "sync_already_running" });
    return;
  }
  if (result.ok) {
    await markRateLimitSuccess(req.userDbName!, "sourceSync");
    const totalRows = result.tables.reduce((sum, table) => sum + table.rows, 0);
    logActivity(
      conn,
      "source-sync",
      `Synced "${source.name}" — ${result.tables.filter((t) => t.status === "ok").length} tables, ${totalRows} rows`,
      { sourceId: id },
    );
  }
  res.status(result.ok ? 200 : 502).json({ result });
}
