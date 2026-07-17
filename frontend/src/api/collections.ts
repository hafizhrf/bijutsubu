import { api } from "@/lib/api";
import type {
  CollectionField,
  CollectionRowsResponse,
  CollectionSample,
  FieldPatchInput,
  MetaCollection,
  MetaRelation,
  NewFieldInput,
  RelationPromptResponse,
  RowRecord,
} from "@/types/collections";

export interface CustomTableResult {
  title: string;
  columns: { field: string; label: string }[];
  rows: Record<string, unknown>[];
  /** Validated QueryDSL behind the rows; round-trips on save. */
  query: unknown;
}

export async function queryCustomTable(prompt: string): Promise<CustomTableResult> {
  const { data } = await api.post<CustomTableResult>("/collections/query", { prompt });
  return data;
}

// ---- Saved custom tables ----

export interface SavedCustomTableSummary {
  _id: string;
  name: string;
  prompt: string;
  title: string;
  createdAt: string;
}

export interface SavedCustomTableDetail extends SavedCustomTableSummary {
  columns: { field: string; label: string }[];
  rows: Record<string, unknown>[];
}

export async function saveCustomTable(input: {
  name: string;
  prompt: string;
  title: string;
  columns: { field: string; label: string }[];
  query: unknown;
}): Promise<SavedCustomTableSummary> {
  const { data } = await api.post<{ customTable: SavedCustomTableSummary }>(
    "/collections/custom-tables",
    input,
  );
  return data.customTable;
}

export async function getSavedCustomTables(): Promise<SavedCustomTableSummary[]> {
  const { data } = await api.get<{ customTables: SavedCustomTableSummary[] }>(
    "/collections/custom-tables",
  );
  return data.customTables;
}

/** Re-executes the saved DSL live — rows always reflect current data. */
export async function getSavedCustomTable(id: string): Promise<SavedCustomTableDetail> {
  const { data } = await api.get<SavedCustomTableDetail>(
    `/collections/custom-tables/${encodeURIComponent(id)}`,
  );
  return data;
}

export async function renameSavedCustomTable(id: string, name: string): Promise<void> {
  await api.patch(`/collections/custom-tables/${encodeURIComponent(id)}`, { name });
}

export async function deleteSavedCustomTable(id: string): Promise<void> {
  await api.delete(`/collections/custom-tables/${encodeURIComponent(id)}`);
}

export async function exportSavedCustomTable(id: string, format: ExportFormat): Promise<Blob> {
  const { data } = await api.get<Blob>(
    `/collections/custom-tables/${encodeURIComponent(id)}/export`,
    { params: { format }, responseType: "blob" },
  );
  return data;
}

export async function getCollections(): Promise<MetaCollection[]> {
  const { data } = await api.get<{ collections: MetaCollection[] }>("/collections");
  return data.collections;
}

export async function getCollectionSample(name: string, limit = 20): Promise<CollectionSample> {
  const { data } = await api.get<CollectionSample>(
    `/collections/${encodeURIComponent(name)}/sample`,
    { params: { limit } },
  );
  return data;
}

export async function getRelations(): Promise<MetaRelation[]> {
  const { data } = await api.get<{ relations: MetaRelation[] }>("/collections/relations");
  return data.relations;
}

export async function promptRelations(prompt: string): Promise<RelationPromptResponse> {
  const { data } = await api.post<RelationPromptResponse>("/collections/relations/prompt", {
    prompt,
  });
  return data;
}

export type ExportFormat = "csv" | "xlsx" | "json";

export interface ColumnFilter {
  field: string;
  op: "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte";
  value: string | number | boolean;
}

export interface RowsQueryOptions {
  search?: string;
  sort?: string;
  sortDir?: "asc" | "desc";
  filters?: ColumnFilter[];
}

function rowsQueryParams(options: RowsQueryOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (options.search) params.search = options.search;
  if (options.sort) {
    params.sort = options.sort;
    params.sortDir = options.sortDir ?? "asc";
  }
  if (options.filters && options.filters.length > 0) {
    params.filters = JSON.stringify(options.filters);
  }
  return params;
}

export async function getRows(
  name: string,
  skip = 0,
  limit = 50,
  options: RowsQueryOptions = {},
): Promise<CollectionRowsResponse> {
  const { data } = await api.get<CollectionRowsResponse>(
    `/collections/${encodeURIComponent(name)}/rows`,
    { params: { skip, limit, ...rowsQueryParams(options) } },
  );
  return data;
}

export async function insertRow(
  name: string,
  row: Record<string, unknown>,
): Promise<{ row: RowRecord; total: number }> {
  const { data } = await api.post<{ row: RowRecord; total: number }>(
    `/collections/${encodeURIComponent(name)}/rows`,
    { row },
  );
  return data;
}

export async function updateRow(
  name: string,
  rowId: string,
  set: Record<string, unknown>,
): Promise<{ ok: true }> {
  const { data } = await api.patch<{ ok: true }>(
    `/collections/${encodeURIComponent(name)}/rows/${encodeURIComponent(rowId)}`,
    { set },
  );
  return data;
}

export async function deleteRow(
  name: string,
  rowId: string,
): Promise<{ ok: true; total: number }> {
  const { data } = await api.delete<{ ok: true; total: number }>(
    `/collections/${encodeURIComponent(name)}/rows/${encodeURIComponent(rowId)}`,
  );
  return data;
}

/** Export matching the current grid view (search/filters/sort) in the given format. */
export async function exportCollectionRows(
  name: string,
  format: ExportFormat,
  options: RowsQueryOptions = {},
): Promise<Blob> {
  const { data } = await api.get<Blob>(`/collections/${encodeURIComponent(name)}/export`, {
    params: { format, ...rowsQueryParams(options) },
    responseType: "blob",
  });
  return data;
}

export async function deleteRowsBulk(
  name: string,
  ids: string[],
): Promise<{ ok: true; deleted: number; total: number }> {
  const { data } = await api.post<{ ok: true; deleted: number; total: number }>(
    `/collections/${encodeURIComponent(name)}/rows/delete`,
    { ids },
  );
  return data;
}

export async function addField(
  name: string,
  field: NewFieldInput,
): Promise<{ field: CollectionField }> {
  const { data } = await api.post<{ field: CollectionField }>(
    `/collections/${encodeURIComponent(name)}/fields`,
    field,
  );
  return data;
}

export async function updateField(
  name: string,
  field: string,
  patch: FieldPatchInput,
): Promise<{ ok: true }> {
  const { data } = await api.patch<{ ok: true }>(
    `/collections/${encodeURIComponent(name)}/fields/${encodeURIComponent(field)}`,
    patch,
  );
  return data;
}

export async function deleteField(name: string, field: string): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(
    `/collections/${encodeURIComponent(name)}/fields/${encodeURIComponent(field)}`,
  );
  return data;
}

export async function updateCollectionMeta(
  name: string,
  patch: { displayName?: string; upsertKey?: string | null },
): Promise<{ ok: true }> {
  const { data } = await api.patch<{ ok: true }>(
    `/collections/${encodeURIComponent(name)}`,
    patch,
  );
  return data;
}

export async function deleteCollection(name: string): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(
    `/collections/${encodeURIComponent(name)}`,
  );
  return data;
}

export interface CollectionDependencies {
  relations: {
    _id: string;
    fromCollection: string;
    toCollection: string;
    fromField: string;
    toField: string;
    type: string;
    counterpart: string;
    counterpartDisplayName: string;
  }[];
  dashboards: { _id: string; title: string }[];
}

/** What breaks if the collection is deleted — shown in the delete confirm. */
export async function getCollectionDependencies(
  name: string,
): Promise<CollectionDependencies> {
  const { data } = await api.get<CollectionDependencies>(
    `/collections/${encodeURIComponent(name)}/dependencies`,
  );
  return data;
}

export interface RowDependent {
  collection: string;
  displayName: string;
  field: string;
  type: string;
  count: number;
}

/** Rows in other collections that reference the given rows via a relation. */
export async function getRowDependencies(
  name: string,
  ids: string[],
): Promise<{ dependents: RowDependent[] }> {
  const { data } = await api.post<{ dependents: RowDependent[] }>(
    `/collections/${encodeURIComponent(name)}/rows/dependencies`,
    { ids },
  );
  return data;
}
