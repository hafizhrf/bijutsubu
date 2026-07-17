import { api } from "@/lib/api";
import type {
  KbChatMessage,
  KnowledgeChatRequest,
  KnowledgeChatResponse,
  KnowledgeDocument,
  KnowledgeDocumentsResponse,
  KnowledgeSegment,
} from "@/types/knowledge";

export async function listKnowledgeDocuments(
  params: { page?: number; search?: string } = {},
): Promise<KnowledgeDocumentsResponse> {
  const { data } = await api.get<KnowledgeDocumentsResponse>("/knowledge/documents", {
    params: {
      page: params.page ?? 1,
      ...(params.search ? { search: params.search } : {}),
    },
  });
  return data;
}

export async function uploadKnowledgeDocument(
  file: File,
  onUploadProgress?: (percent: number) => void,
): Promise<{ document: KnowledgeDocument }> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<{ document: KnowledgeDocument }>(
    "/knowledge/documents",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (event) => {
        if (onUploadProgress && event.total) {
          onUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    },
  );
  return data;
}

export async function getKnowledgeDocumentSegments(
  docId: string,
): Promise<{ segments: KnowledgeSegment[] }> {
  const { data } = await api.get<{ segments: KnowledgeSegment[] }>(
    `/knowledge/documents/${encodeURIComponent(docId)}/segments`,
  );
  return data;
}

export async function deleteKnowledgeDocument(docId: string): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(
    `/knowledge/documents/${encodeURIComponent(docId)}`,
  );
  return data;
}

export async function getKnowledgeChat(): Promise<{ messages: KbChatMessage[] }> {
  const { data } = await api.get<{ messages: KbChatMessage[] }>("/knowledge/chat");
  return data;
}

export async function sendKnowledgeChat(
  message: string,
  requestId: string,
): Promise<KnowledgeChatResponse> {
  const request = {
    message,
    requestId,
  } satisfies KnowledgeChatRequest;
  const { data } = await api.post<KnowledgeChatResponse>("/knowledge/chat", request);
  return data;
}

export async function clearKnowledgeChat(): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>("/knowledge/chat");
  return data;
}
