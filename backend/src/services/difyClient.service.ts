import { env } from "../config/env.js";

/**
 * Thin client for the Dify knowledge (dataset) API, using native fetch.
 * The dataset-scoped API key lives server-side only; every function takes an
 * explicit datasetId that callers must resolve from the authenticated user
 * (see kbDataset.service.ts) — never from request input.
 */

export class DifyError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? `Dify request failed (${status}, ${code})`);
    this.status = status;
    this.code = code;
  }
}

async function difyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.DIFY_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.DIFY_DATASET_API_KEY}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new DifyError(0, "dify_unavailable", "Could not reach the Dify server");
  }

  if (!response.ok) {
    let code = "dify_error";
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      code = body.code ?? code;
    } catch {
      // Non-JSON error body — keep the generic code.
    }
    if (response.status >= 500) {
      throw new DifyError(response.status, "dify_unavailable");
    }
    throw new DifyError(response.status, code);
  }

  // DELETE returns 204 with an empty body.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface DifyDocument {
  id: string;
  name: string;
  indexing_status: string;
  word_count: number | null;
  created_at: number;
  error: string | null;
}

export async function createDataset(name: string): Promise<{ id: string }> {
  return difyFetch<{ id: string }>("/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, indexing_technique: "high_quality" }),
  });
}

export async function createDocumentByFile(
  datasetId: string,
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<{ document: DifyDocument }> {
  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      indexing_technique: "high_quality",
      process_rule: { mode: "automatic" },
    }),
  );
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
  // No Content-Type header: fetch sets the multipart boundary itself.
  return difyFetch<{ document: DifyDocument }>(
    `/datasets/${datasetId}/document/create-by-file`,
    { method: "POST", body: form },
  );
}

export async function listDocuments(
  datasetId: string,
  options: { page?: number; limit?: number; keyword?: string } = {},
): Promise<{ data: DifyDocument[]; total: number }> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    limit: String(options.limit ?? 20),
  });
  if (options.keyword) params.set("keyword", options.keyword);
  return difyFetch<{ data: DifyDocument[]; total: number }>(
    `/datasets/${datasetId}/documents?${params.toString()}`,
  );
}

export async function deleteDocument(datasetId: string, documentId: string): Promise<void> {
  await difyFetch<unknown>(`/datasets/${datasetId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export interface DifySegment {
  id: string;
  position: number;
  content: string;
}

export async function getDocumentSegments(
  datasetId: string,
  documentId: string,
): Promise<{ data: DifySegment[] }> {
  return difyFetch<{ data: DifySegment[] }>(
    `/datasets/${datasetId}/documents/${documentId}/segments?limit=100`,
  );
}

export interface DifyRetrievalRecord {
  segment: {
    content: string;
    document: { id: string; name: string };
  };
  score: number | null;
}

export async function retrieve(
  datasetId: string,
  query: string,
  topK = 8,
): Promise<DifyRetrievalRecord[]> {
  const result = await difyFetch<{ records: DifyRetrievalRecord[] }>(
    `/datasets/${datasetId}/retrieve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        retrieval_model: {
          search_method: "semantic_search",
          reranking_enable: false,
          top_k: topK,
          score_threshold_enabled: false,
        },
      }),
    },
  );
  return result.records ?? [];
}
