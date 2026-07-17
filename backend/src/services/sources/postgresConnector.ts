import pg from "pg";
import { assertHostAllowed } from "./hostGuard.util.js";
import { SourceConfig, SourceConnector, SourceError, SourceFieldType, SourceTableInfo } from "./types.js";

/**
 * PostgreSQL connector (public schema). Read-only by construction:
 * introspection via information_schema/pg_catalog plus SELECTs whose
 * identifiers are double-quote escaped and validated against the live
 * table list.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 60_000;

// pg returns NUMERIC (1700) and BIGINT (20) as strings for precision safety;
// the workspace stores analytics-grade numbers, so double precision is fine.
pg.types.setTypeParser(1700, (value) => Number(value));
pg.types.setTypeParser(20, (value) => Number(value));

/** "ident" quoting: embedded double quotes doubled. */
function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function mapType(dataType: string): SourceFieldType {
  const type = dataType.toLowerCase();
  if (["smallint", "integer", "bigint", "numeric", "decimal", "real", "double precision", "money", "smallserial", "serial", "bigserial"].includes(type)) return "number";
  if (type.startsWith("timestamp") || type === "date" || type.startsWith("time")) return "date";
  if (type === "boolean") return "boolean";
  if (type === "json" || type === "jsonb") return "object";
  if (type === "array") return "array";
  return "string";
}

function mapError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const code = (error as { code?: string })?.code ?? "";
  if (code === "28P01" || code === "28000") return new SourceError("auth_failed");
  if (code === "3D000") return new SourceError("unknown_database");
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH") return new SourceError("unreachable");
  if (code === "ETIMEDOUT" || /timeout/i.test((error as Error)?.message ?? "")) return new SourceError("timeout");
  return new SourceError("query_failed");
}

async function withClient<T>(config: SourceConfig, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  await assertHostAllowed(config.host);
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  try {
    await client.connect();
    return await fn(client);
  } catch (error) {
    throw mapError(error);
  } finally {
    await client.end().catch(() => {});
  }
}

export const postgresConnector: SourceConnector = {
  async test(config) {
    await withClient(config, async (client) => {
      await client.query("SELECT 1");
    });
  },

  async listTables(config) {
    return withClient(config, async (client) => {
      const tables = await client.query(
        `SELECT c.relname AS name, c.reltuples::bigint AS approx_rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
      );
      const columns = await client.query(
        `SELECT table_name AS tbl, column_name AS col, data_type AS data_type
         FROM information_schema.columns WHERE table_schema = 'public'
         ORDER BY table_name, ordinal_position`,
      );
      const keys = await client.query(
        `SELECT tc.table_name AS tbl, kcu.column_name AS col, tc.constraint_type AS kind,
                ccu.table_name AS ref_table, ccu.column_name AS ref_col, tc.constraint_name AS cname
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`,
      );

      const byTable = new Map<string, SourceTableInfo>();
      for (const table of tables.rows) {
        byTable.set(String(table.name), {
          name: String(table.name),
          columns: [],
          pk: null,
          fks: [],
          approxRows: table.approx_rows === null ? null : Math.max(0, Number(table.approx_rows)),
        });
      }
      for (const column of columns.rows) {
        byTable.get(String(column.tbl))?.columns.push({
          name: String(column.col),
          type: mapType(String(column.data_type)),
        });
      }
      const pkCounts = new Map<string, number>();
      for (const key of keys.rows) {
        if (key.kind === "PRIMARY KEY") pkCounts.set(String(key.tbl), (pkCounts.get(String(key.tbl)) ?? 0) + 1);
      }
      for (const key of keys.rows) {
        const info = byTable.get(String(key.tbl));
        if (!info) continue;
        if (key.kind === "PRIMARY KEY" && pkCounts.get(String(key.tbl)) === 1) {
          info.pk = String(key.col);
        } else if (key.kind === "FOREIGN KEY") {
          info.fks.push({ fromField: String(key.col), toTable: String(key.ref_table), toField: String(key.ref_col) });
        }
      }
      return [...byTable.values()];
    });
  },

  async fetchRows(config, table, limit) {
    return withClient(config, async (client) => {
      const exists = await client.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = $1`,
        [table],
      );
      if (exists.rowCount === 0) throw new SourceError("table_not_found");
      const result = await client.query(`SELECT * FROM "public".${quoteIdent(table)} LIMIT $1`, [limit]);
      return result.rows as Record<string, unknown>[];
    });
  },
};
