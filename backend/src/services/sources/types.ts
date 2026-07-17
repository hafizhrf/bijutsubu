/** Shared contracts for external data-source connectors. */

export type SourceEngine = "mysql" | "postgres" | "mongodb";

export type SourceFieldType = "string" | "number" | "boolean" | "date" | "array" | "object";

export interface SourceConfig {
  engine: SourceEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface SourceTableInfo {
  name: string;
  columns: { name: string; type: SourceFieldType }[];
  /** Single-column primary key, when one exists. */
  pk: string | null;
  fks: { fromField: string; toTable: string; toField: string }[];
  approxRows: number | null;
}

export interface SourceConnector {
  /** Connects and runs a trivial probe; throws a SourceError on failure. */
  test(config: SourceConfig): Promise<void>;
  listTables(config: SourceConfig): Promise<SourceTableInfo[]>;
  /** Reads up to `limit` rows. `table` must come from listTables output. */
  fetchRows(config: SourceConfig, table: string, limit: number): Promise<Record<string, unknown>[]>;
}

/** Stable, client-safe error codes — raw driver messages are never exposed. */
export type SourceErrorCode =
  | "auth_failed"
  | "unreachable"
  | "unknown_database"
  | "timeout"
  | "private_host_blocked"
  | "table_not_found"
  | "query_failed";

export class SourceError extends Error {
  constructor(public readonly code: SourceErrorCode) {
    super(code);
    this.name = "SourceError";
  }
}
