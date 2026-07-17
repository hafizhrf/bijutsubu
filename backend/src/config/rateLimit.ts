import { env } from "./env.js";

export type RateLimitedAction =
  | "upload"
  | "uploadPlan"
  | "genui"
  | "kbUpload"
  | "kbChat"
  | "insight"
  | "sourceSync";

export const RATE_LIMIT_WINDOWS_MS: Record<RateLimitedAction, number> = {
  upload: env.UPLOAD_RATE_LIMIT_MINUTES * 60_000,
  // uploadPlan covers the LLM planning call, which runs (and costs) even when
  // the user later cancels instead of applying the upload.
  uploadPlan: env.UPLOAD_PLAN_RATE_LIMIT_MINUTES * 60_000,
  genui: env.GENUI_RATE_LIMIT_MINUTES * 60_000,
  // Knowledge-base actions: upload has no LLM planning step, chat only needs a
  // short anti-spam window (default 0.2 min = 12s).
  kbUpload: env.KB_UPLOAD_RATE_LIMIT_MINUTES * 60_000,
  kbChat: env.KB_CHAT_RATE_LIMIT_MINUTES * 60_000,
  insight: env.GENUI_RATE_LIMIT_MINUTES * 60_000,
  // Manual "Sync now" anti-spam window; scheduled syncs bypass rate limiting.
  sourceSync: env.SOURCE_SYNC_RATE_LIMIT_MINUTES * 60_000,
};

export const UPLOAD_MAX_FILE_SIZE_BYTES = env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  // Browsers often send .sql as application/octet-stream; the extension
  // entry below is what actually admits those files (mime OR ext check).
  "application/sql",
  "application/x-sql",
]);

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".xls",
  ".xlsx",
  ".docx",
  ".txt",
  ".md",
  ".sql",
]);

// Knowledge-base uploads go straight to Dify (not through documentParser), so
// the accept list is intentionally broader than ALLOWED_UPLOAD_* — anything
// Dify can index, images excluded.
export const KB_ALLOWED_MIME_TYPES = new Set([
  ...ALLOWED_UPLOAD_MIME_TYPES,
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const KB_ALLOWED_EXTENSIONS = new Set([
  ...ALLOWED_UPLOAD_EXTENSIONS,
  ".pptx",
  ".html",
  ".htm",
  ".json",
  ".xml",
]);
