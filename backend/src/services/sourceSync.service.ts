import { Connection } from "mongoose";
import { env } from "../config/env.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { getMetaSourceModel } from "../models/metaSource.model.js";
import { decryptCredential } from "./credentialVault.util.js";
import {
  buildFieldRenameMap,
  getConnector,
  sanitizeNestedKeys,
  SourceConfig,
  SourceEngine,
  SourceError,
  SourceTableInfo,
} from "./sources/index.js";

/**
 * Pull-sync of one connected database source into the user's workspace.
 * Each enabled table is mirrored with a full refresh through a shadow
 * collection (write to `<target>__sync_tmp`, then rename with dropTarget) so
 * readers never observe an empty collection mid-sync. Field names are
 * sanitized/renamed for Mongo-key and FIELD_NAME_PATTERN safety, and SQL
 * foreign keys become MetaRelations, exactly like the SQL-dump importer.
 */

const INSERT_BATCH = 1000;

export interface SyncTableStat {
  table: string;
  targetCollection: string;
  rows: number;
  status: "ok" | "error";
  error?: string;
}

export interface SyncResult {
  ok: boolean;
  tables: SyncTableStat[];
  /** Stable error code when the whole source failed (e.g. auth). */
  error?: string;
}

interface MetaSourceDocLike {
  _id: unknown;
  name: string;
  engine: SourceEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  encryptedPassword: string;
  ssl: boolean;
  tables: { sourceTable: string; targetCollection: string; upsertKey: string | null; enabled: boolean }[];
}

export function sourceConfigOf(source: MetaSourceDocLike): SourceConfig {
  return {
    engine: source.engine,
    host: source.host,
    port: source.port,
    database: source.database,
    username: source.username,
    password: source.encryptedPassword ? decryptCredential(source.encryptedPassword) : "",
    ssl: source.ssl,
  };
}

// In-memory per-process run locks so the scheduler and manual "Sync now"
// never sync the same source concurrently (same caveat as the generation
// progress map: disposable state, single-process).
const runningSyncs = new Set<string>();

export function isSourceSyncRunning(dbName: string, sourceId: string): boolean {
  return runningSyncs.has(`${dbName}:${sourceId}`);
}

/** Lock-guarded sync; returns null when this source is already syncing. */
export async function runSourceSync(
  dbName: string,
  conn: Connection,
  source: MetaSourceDocLike,
): Promise<SyncResult | null> {
  const key = `${dbName}:${String(source._id)}`;
  if (runningSyncs.has(key)) return null;
  runningSyncs.add(key);
  try {
    return await syncSource(conn, source);
  } finally {
    runningSyncs.delete(key);
  }
}

export async function syncSource(conn: Connection, source: MetaSourceDocLike): Promise<SyncResult> {
  const MetaSource = getMetaSourceModel(conn);
  const connector = getConnector(source.engine);
  const config = sourceConfigOf(source);

  let remoteTables: SourceTableInfo[];
  try {
    remoteTables = await connector.listTables(config);
  } catch (error) {
    const code = error instanceof SourceError ? error.code : "query_failed";
    await MetaSource.updateOne(
      { _id: source._id },
      { $set: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: code, lastSyncStats: null } },
    );
    return { ok: false, tables: [], error: code };
  }
  const remoteByName = new Map(remoteTables.map((table) => [table.name, table]));

  const enabled = source.tables.filter((table) => table.enabled);
  const targetByRemoteTable = new Map(enabled.map((table) => [table.sourceTable, table.targetCollection]));
  const stats: SyncTableStat[] = [];
  const MetaCollection = getMetaCollectionModel(conn);
  const MetaRelation = getMetaRelationModel(conn);

  for (const mapping of enabled) {
    const info = remoteByName.get(mapping.sourceTable);
    if (!info) {
      stats.push({ table: mapping.sourceTable, targetCollection: mapping.targetCollection, rows: 0, status: "error", error: "table_not_found" });
      continue;
    }
    try {
      // Ownership guard: never clobber a collection this source doesn't own.
      const existingMeta = await MetaCollection.findOne({ name: mapping.targetCollection }).lean();
      if (existingMeta && existingMeta.source?.sourceId !== String(source._id)) {
        stats.push({ table: mapping.sourceTable, targetCollection: mapping.targetCollection, rows: 0, status: "error", error: "target_conflict" });
        continue;
      }

      const rawRows = await connector.fetchRows(config, mapping.sourceTable, env.SOURCE_SYNC_MAX_ROWS);

      // Sanitize field names once for the union of schema columns + row keys.
      const nameUnion = [...info.columns.map((column) => column.name)];
      for (const row of rawRows) {
        for (const key of Object.keys(row)) if (!nameUnion.includes(key)) nameUnion.push(key);
      }
      const rename = buildFieldRenameMap(nameUnion);
      const rows = rawRows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          out[rename.get(key) ?? key] = sanitizeNestedKeys(value);
        }
        return out;
      });

      // Shadow swap: readers keep seeing the old data until the rename.
      const tmpName = `${mapping.targetCollection}__sync_tmp`;
      const db = conn.db!;
      await db.collection(tmpName).drop().catch(() => {});
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += INSERT_BATCH) {
          await db.collection(tmpName).insertMany(rows.slice(i, i + INSERT_BATCH));
        }
      } else {
        await db.createCollection(tmpName);
      }
      await db.renameCollection(tmpName, mapping.targetCollection, { dropTarget: true });

      const fields = nameUnion.map((original) => ({
        name: rename.get(original) ?? original,
        type: info.columns.find((column) => column.name === original)?.type ?? "string",
        nullable: true,
      }));
      const pk = info.pk ? (rename.get(info.pk) ?? info.pk) : null;
      await MetaCollection.findOneAndUpdate(
        { name: mapping.targetCollection },
        {
          $set: {
            displayName: mapping.sourceTable,
            fields,
            createdVia: "datasource",
            upsertKey: pk,
            rowCount: rows.length,
            source: {
              sourceId: String(source._id),
              sourceName: source.name,
              engine: source.engine,
              table: mapping.sourceTable,
              lastSyncedAt: new Date(),
            },
          },
        },
        { upsert: true },
      );

      // SQL FKs → relations, only between tables synced by this source.
      for (const fk of info.fks) {
        const toCollection = targetByRemoteTable.get(fk.toTable);
        if (!toCollection) continue;
        await MetaRelation.findOneAndUpdate(
          { fromCollection: mapping.targetCollection, toCollection },
          {
            $set: {
              fromField: rename.get(fk.fromField) ?? fk.fromField,
              toField: fk.toField,
              type: "one-to-many",
              description: `Synced from ${source.engine} foreign key ${mapping.sourceTable}.${fk.fromField} → ${fk.toTable}.${fk.toField}`,
              createdVia: "datasource",
            },
          },
          { upsert: true },
        );
      }

      stats.push({ table: mapping.sourceTable, targetCollection: mapping.targetCollection, rows: rows.length, status: "ok" });
    } catch (error) {
      const code = error instanceof SourceError ? error.code : "query_failed";
      stats.push({ table: mapping.sourceTable, targetCollection: mapping.targetCollection, rows: 0, status: "error", error: code });
    }
  }

  const allFailed = stats.length > 0 && stats.every((stat) => stat.status === "error");
  await MetaSource.updateOne(
    { _id: source._id },
    {
      $set: {
        lastSyncAt: new Date(),
        lastSyncStatus: allFailed ? "error" : "ok",
        lastSyncError: allFailed ? (stats[0]?.error ?? "query_failed") : null,
        lastSyncStats: stats,
      },
    },
  );
  return { ok: !allFailed, tables: stats };
}
