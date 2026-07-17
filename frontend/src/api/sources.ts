import { api } from "@/lib/api";

/** External database sources (MySQL/MariaDB, PostgreSQL, MongoDB). */

export type SourceEngine = "mysql" | "postgres" | "mongodb";

export interface SourceConnectionInput {
  engine: SourceEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface SourceTableSummary {
  name: string;
  columnCount: number;
  pk: string | null;
  approxRows: number | null;
}

export interface SourceTableMapping {
  sourceTable: string;
  targetCollection: string;
  upsertKey: string | null;
  enabled: boolean;
}

export interface SourceSyncTableStat {
  table: string;
  targetCollection: string;
  rows: number;
  status: "ok" | "error";
  error?: string;
}

export interface DataSource {
  _id: string;
  name: string;
  engine: SourceEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  tables: SourceTableMapping[];
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastSyncStatus: "ok" | "error" | null;
  lastSyncError: string | null;
  lastSyncStats: SourceSyncTableStat[] | null;
  createdAt: string;
  syncing: boolean;
}

export async function testSourceConnection(
  input: SourceConnectionInput,
): Promise<{ ok: boolean; tables: SourceTableSummary[] }> {
  const { data } = await api.post<{ ok: boolean; tables: SourceTableSummary[] }>(
    "/sources/test",
    input,
  );
  return data;
}

export async function createSource(
  input: SourceConnectionInput & { name: string; syncIntervalMinutes: number; tables: string[] },
): Promise<DataSource> {
  const { data } = await api.post<{ source: DataSource }>("/sources", input);
  return data.source;
}

export async function getSources(): Promise<DataSource[]> {
  const { data } = await api.get<{ sources: DataSource[] }>("/sources");
  return data.sources;
}

export async function updateSource(
  id: string,
  patch: { name?: string; syncIntervalMinutes?: number; password?: string; tables?: string[] },
): Promise<DataSource> {
  const { data } = await api.patch<{ source: DataSource }>(`/sources/${encodeURIComponent(id)}`, patch);
  return data.source;
}

export async function deleteSource(id: string): Promise<void> {
  await api.delete(`/sources/${encodeURIComponent(id)}`);
}

export async function syncSourceNow(
  id: string,
): Promise<{ ok: boolean; tables: SourceSyncTableStat[] }> {
  const { data } = await api.post<{ result: { ok: boolean; tables: SourceSyncTableStat[] } }>(
    `/sources/${encodeURIComponent(id)}/sync`,
  );
  return data.result;
}
