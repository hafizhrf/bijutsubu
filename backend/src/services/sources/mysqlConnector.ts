import mysql from "mysql2/promise";
import { assertHostAllowed } from "./hostGuard.util.js";
import { SourceConfig, SourceConnector, SourceError, SourceFieldType, SourceTableInfo } from "./types.js";

/**
 * MySQL / MariaDB connector. Read-only by construction: introspection via
 * information_schema plus SELECTs whose identifiers are escaped with
 * mysql.escapeId and validated against the live table list.
 */

const CONNECT_TIMEOUT_MS = 10_000;

function mapType(dataType: string): SourceFieldType {
  const type = dataType.toLowerCase();
  if (["tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "numeric", "float", "double", "year"].includes(type)) return "number";
  if (["date", "datetime", "timestamp"].includes(type)) return "date";
  if (["bit", "bool", "boolean"].includes(type)) return "boolean";
  if (type === "json") return "object";
  return "string";
}

function mapError(error: unknown): SourceError {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") return new SourceError("auth_failed");
  if (code === "ER_BAD_DB_ERROR") return new SourceError("unknown_database");
  if (code === "ETIMEDOUT" || code === "ETIMEOUT") return new SourceError("timeout");
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH") return new SourceError("unreachable");
  if (error instanceof SourceError) return error;
  return new SourceError("query_failed");
}

async function connect(config: SourceConfig): Promise<mysql.Connection> {
  await assertHostAllowed(config.host);
  try {
    return await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // DECIMAL/NUMERIC as JS numbers (default is strings) and DATE/DATETIME
      // read as UTC so calendar dates don't shift with the server timezone.
      decimalNumbers: true,
      timezone: "Z",
    });
  } catch (error) {
    throw mapError(error);
  }
}

async function withConnection<T>(config: SourceConfig, fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await connect(config);
  try {
    return await fn(conn);
  } catch (error) {
    throw mapError(error);
  } finally {
    await conn.end().catch(() => {});
  }
}

export const mysqlConnector: SourceConnector = {
  async test(config) {
    await withConnection(config, async (conn) => {
      await conn.query("SELECT 1");
    });
  },

  async listTables(config) {
    return withConnection(config, async (conn) => {
      const [tables] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME",
        [config.database],
      );
      const [columns] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, DATA_TYPE AS dataType, ORDINAL_POSITION AS pos FROM information_schema.columns WHERE table_schema = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
        [config.database],
      );
      const [keys] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT k.TABLE_NAME AS tbl, k.COLUMN_NAME AS col, c.CONSTRAINT_TYPE AS kind,
                k.REFERENCED_TABLE_NAME AS refTable, k.REFERENCED_COLUMN_NAME AS refCol
         FROM information_schema.key_column_usage k
         JOIN information_schema.table_constraints c
           ON c.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME
         WHERE k.TABLE_SCHEMA = ? AND c.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY')`,
        [config.database],
      );

      const byTable = new Map<string, SourceTableInfo>();
      for (const table of tables) {
        byTable.set(String(table.name), {
          name: String(table.name),
          columns: [],
          pk: null,
          fks: [],
          approxRows: table.approxRows === null ? null : Number(table.approxRows),
        });
      }
      for (const column of columns) {
        byTable.get(String(column.tbl))?.columns.push({
          name: String(column.col),
          type: mapType(String(column.dataType)),
        });
      }
      const pkCounts = new Map<string, number>();
      for (const key of keys) {
        if (key.kind === "PRIMARY KEY") pkCounts.set(String(key.tbl), (pkCounts.get(String(key.tbl)) ?? 0) + 1);
      }
      for (const key of keys) {
        const info = byTable.get(String(key.tbl));
        if (!info) continue;
        if (key.kind === "PRIMARY KEY" && pkCounts.get(String(key.tbl)) === 1) {
          info.pk = String(key.col);
        } else if (key.kind === "FOREIGN KEY" && key.refTable) {
          info.fks.push({ fromField: String(key.col), toTable: String(key.refTable), toField: String(key.refCol) });
        }
      }
      return [...byTable.values()];
    });
  },

  async fetchRows(config, table, limit) {
    return withConnection(config, async (conn) => {
      const [exists] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND TABLE_NAME = ? AND table_type = 'BASE TABLE'",
        [config.database, table],
      );
      if (exists.length === 0) throw new SourceError("table_not_found");
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${mysql.escapeId(table)} LIMIT ?`,
        [limit],
      );
      return rows.map((row) => ({ ...row }));
    });
  },
};
