export interface KnowledgeDocument {
  id: string;
  name: string;
  /** Dify statuses: queued/waiting/parsing/cleaning/splitting/indexing/completed/error/paused */
  indexingStatus: string;
  wordCount: number;
  createdAt: string;
  error: string | null;
}

export interface KnowledgeDocumentsResponse {
  /** false until the user's first upload lazily creates their Dify dataset. */
  datasetReady: boolean;
  documents: KnowledgeDocument[];
  /** Total documents matching the search (across all pages). */
  total: number;
  page: number;
  pageSize: number;
}

export interface KnowledgeSegment {
  position: number;
  content: string;
}

export interface KbChatMessage {
  role: "user" | "assistant";
  content: string;
  sources: string[];
  createdAt: string;
  requestId: string | null;
}

export interface KnowledgeChatRequest {
  message: string;
  /** Stable job id used to make retries idempotent. */
  requestId: string;
}

export interface KnowledgeChatResponse {
  userMessage: KbChatMessage;
  message: KbChatMessage;
}
