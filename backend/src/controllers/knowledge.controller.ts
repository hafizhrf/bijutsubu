import { Request, Response } from "express";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getKbChatMessageModel } from "../models/kbChatMessage.model.js";
import {
  DifyError,
  createDocumentByFile,
  deleteDocument,
  getDocumentSegments,
  listDocuments,
  retrieve,
} from "../services/difyClient.service.js";
import { ensureUserDataset, getUserDatasetId } from "../services/kbDataset.service.js";
import { completeJSON } from "../services/llmClient.service.js";
import { KbAnswerSchema } from "../schemas/kbAnswer.schema.js";
import {
  getRateLimitRetryAfter,
  markRateLimitSuccess,
} from "../middleware/rateLimit.js";
import { logActivity } from "../services/activityLog.service.js";

const DOC_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

/** Maps Dify failures to a clean client error; rethrows anything else. */
function handleDifyError(res: Response, error: unknown): boolean {
  if (error instanceof DifyError) {
    if (error.code === "dify_unavailable") {
      res.status(502).json({ error: "knowledge_service_unavailable" });
    } else if (error.status === 404) {
      res.status(404).json({ error: "document_not_found" });
    } else {
      res.status(502).json({ error: "knowledge_service_error", detail: error.code });
    }
    return true;
  }
  return false;
}

function toDocumentDto(doc: {
  id: string;
  name: string;
  indexing_status: string;
  word_count: number | null;
  created_at: number;
  error: string | null;
}) {
  return {
    id: doc.id,
    name: doc.name,
    indexingStatus: doc.indexing_status,
    wordCount: doc.word_count ?? 0,
    createdAt: new Date(doc.created_at * 1000).toISOString(),
    error: doc.error ?? null,
  };
}

const DOCUMENTS_PAGE_SIZE = 20;

export async function listKnowledgeDocuments(req: Request, res: Response) {
  const page = Math.min(Math.max(Number.parseInt(String(req.query.page ?? "1"), 10) || 1, 1), 500);
  const keyword =
    typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";

  const datasetId = await getUserDatasetId(req.userId!);
  if (!datasetId) {
    res.status(200).json({
      datasetReady: false,
      documents: [],
      total: 0,
      page: 1,
      pageSize: DOCUMENTS_PAGE_SIZE,
    });
    return;
  }
  try {
    const result = await listDocuments(datasetId, {
      page,
      limit: DOCUMENTS_PAGE_SIZE,
      keyword: keyword || undefined,
    });
    res.status(200).json({
      datasetReady: true,
      documents: result.data.map(toDocumentDto),
      total: result.total,
      page,
      pageSize: DOCUMENTS_PAGE_SIZE,
    });
  } catch (error) {
    if (!handleDifyError(res, error)) throw error;
  }
}

export async function uploadKnowledgeDocument(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ error: "missing_file" });
    return;
  }
  try {
    const datasetId = await ensureUserDataset(req.userId!);
    const result = await createDocumentByFile(
      datasetId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    await markRateLimitSuccess(req.userDbName!, "kbUpload");
    const conn = getUserConnection(req.userDbName!);
    logActivity(conn, "document-kb-upload", `Added ${req.file.originalname} to the knowledge base`, {
      documentId: result.document.id,
    });
    res.status(201).json({ document: toDocumentDto(result.document) });
  } catch (error) {
    if (!handleDifyError(res, error)) throw error;
  }
}

export async function getKnowledgeDocumentSegments(req: Request, res: Response) {
  const docId = String(req.params.docId);
  if (!DOC_ID_PATTERN.test(docId)) {
    res.status(400).json({ error: "invalid_document_id" });
    return;
  }
  const datasetId = await getUserDatasetId(req.userId!);
  if (!datasetId) {
    res.status(404).json({ error: "document_not_found" });
    return;
  }
  try {
    const result = await getDocumentSegments(datasetId, docId);
    res.status(200).json({
      segments: result.data
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((segment) => ({ position: segment.position, content: segment.content })),
    });
  } catch (error) {
    if (!handleDifyError(res, error)) throw error;
  }
}

export async function deleteKnowledgeDocument(req: Request, res: Response) {
  const docId = String(req.params.docId);
  if (!DOC_ID_PATTERN.test(docId)) {
    res.status(400).json({ error: "invalid_document_id" });
    return;
  }
  const datasetId = await getUserDatasetId(req.userId!);
  if (!datasetId) {
    res.status(200).json({ ok: true });
    return;
  }
  try {
    await deleteDocument(datasetId, docId);
  } catch (error) {
    // Idempotent: a document already gone is a success.
    if (error instanceof DifyError && error.status === 404) {
      res.status(200).json({ ok: true });
      return;
    }
    if (!handleDifyError(res, error)) throw error;
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  logActivity(conn, "document-kb-delete", "Removed a document from the knowledge base", {
    documentId: docId,
  });
  res.status(200).json({ ok: true });
}

// ---- RAG chat ----

const CHAT_HISTORY_LIMIT = 200;
const HISTORY_IN_PROMPT = 6;
const CHUNK_CHAR_LIMIT = 2000;

const ChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  requestId: z.string().uuid(),
});

function chatMessageIdForRequest(
  requestId: string,
  role: "user" | "assistant",
): mongoose.Types.ObjectId {
  const hex = createHash("sha256").update(`${requestId}:${role}`).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const CHAT_SYSTEM_PROMPT = `You are a knowledge-base assistant. Answer the user's question using ONLY
the provided document excerpts from their personal knowledge base.

Rules:
- Ground every claim in the excerpts. NEVER use outside knowledge, even for
  well-known facts.
- If the excerpts do not contain the answer, say you could not find it in
  their documents (in the user's language) — do not guess.
- Answer in the same language the user asked in.
- "sources" must list the exact document names (from the excerpt headers) you
  actually used; leave it empty when you could not answer.

Respond with ONLY a JSON object: { "answer": string, "sources": string[] }`;

export async function getKnowledgeChat(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const messages = await getKbChatMessageModel(conn)
    .find()
    .sort({ createdAt: 1 })
    .limit(CHAT_HISTORY_LIMIT)
    .lean();
  res.status(200).json({
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      sources: message.sources ?? [],
      createdAt: message.createdAt,
      requestId: message.requestId ?? null,
    })),
  });
}

export async function sendKnowledgeChat(req: Request, res: Response) {
  const parsed = ChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const question = parsed.data.message.trim();
  const { requestId } = parsed.data;
  const conn = getUserConnection(req.userDbName!);
  const KbChatMessage = getKbChatMessageModel(conn);
  const userMessageId = chatMessageIdForRequest(requestId, "user");
  const assistantMessageId = chatMessageIdForRequest(requestId, "assistant");

  const [existingUser, existingAssistant] = await Promise.all([
    KbChatMessage.findById(userMessageId).lean(),
    KbChatMessage.findById(assistantMessageId).lean(),
  ]);
  if (existingAssistant) {
    if (!existingUser || existingUser.content !== question) {
      res.status(409).json({ error: "knowledge_chat_request_id_reused" });
      return;
    }
    res.status(200).json({
      userMessage: {
        role: "user",
        content: existingUser.content,
        sources: existingUser.sources ?? [],
        createdAt: existingUser.createdAt,
        requestId,
      },
      message: {
        role: "assistant",
        content: existingAssistant.content,
        sources: existingAssistant.sources ?? [],
        createdAt: existingAssistant.createdAt,
        requestId,
      },
    });
    return;
  }

  async function respondWith(answer: string, sources: string[]) {
    try {
      await KbChatMessage.updateOne(
        { _id: userMessageId },
        {
          $setOnInsert: {
            requestId,
            role: "user",
            content: question,
            sources: [],
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    const savedUser = await KbChatMessage.findById(userMessageId).lean();
    if (!savedUser || savedUser.content !== question) {
      throw new Error("Knowledge chat user message was not found after idempotent upsert");
    }

    let inserted = false;
    try {
      const writeResult = await KbChatMessage.updateOne(
        { _id: assistantMessageId },
        {
          $setOnInsert: {
            requestId,
            role: "assistant",
            content: answer,
            sources,
            createdAt: new Date(new Date(savedUser.createdAt).getTime() + 1),
          },
        },
        { upsert: true },
      );
      inserted = writeResult.upsertedCount === 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    const savedAssistant = await KbChatMessage.findById(assistantMessageId).lean();
    if (!savedAssistant) {
      throw new Error("Knowledge chat answer was not found after idempotent upsert");
    }
    return {
      inserted,
      userMessage: {
        role: "user" as const,
        content: savedUser.content,
        sources: savedUser.sources ?? [],
        createdAt: savedUser.createdAt,
        requestId,
      },
      message: {
        role: "assistant" as const,
        content: savedAssistant.content,
        sources: savedAssistant.sources ?? [],
        createdAt: savedAssistant.createdAt,
        requestId,
      },
    };
  }

  // Completed retries return above before the cooldown check. Only requests
  // that can start new retrieval/LLM work are rate-limited here.
  const retryAfterMs = await getRateLimitRetryAfter(req.userDbName!, "kbChat");
  if (retryAfterMs !== null) {
    res.status(429).json({ error: "rate_limited", retryAfterMs });
    return;
  }

  // Empty knowledge base: answer without consuming quota — retries stay free.
  const datasetId = await getUserDatasetId(req.userId!);
  if (!datasetId) {
    const saved = await respondWith(
      "Your knowledge base is empty — upload some documents first, then ask me about them.",
      [],
    );
    res.status(200).json({ userMessage: saved.userMessage, message: saved.message });
    return;
  }

  try {
    const records = await retrieve(datasetId, question, 8);

    if (records.length === 0) {
      const saved = await respondWith(
        "I couldn't find anything about that in your documents. Try rephrasing, or upload a document that covers it.",
        [],
      );
      if (saved.inserted) await markRateLimitSuccess(req.userDbName!, "kbChat");
      res.status(200).json({ userMessage: saved.userMessage, message: saved.message });
      return;
    }

    const history = await KbChatMessage.find({
      _id: { $nin: [userMessageId, assistantMessageId] },
    })
      .sort({ createdAt: -1 })
      .limit(HISTORY_IN_PROMPT)
      .lean();
    const historyBlock = history
      .reverse()
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
      .join("\n");

    const contextBlock = records
      .map(
        (record, index) =>
          `[${index + 1}] (document: ${record.segment.document.name})\n${record.segment.content.slice(0, CHUNK_CHAR_LIMIT)}`,
      )
      .join("\n\n");

    const userPrompt = `Recent conversation (may be empty):
${historyBlock || "(none)"}

Document excerpts from the user's knowledge base:
${contextBlock}

Question: ${question}`;

    const result = await completeJSON(CHAT_SYSTEM_PROMPT, userPrompt, KbAnswerSchema);
    // Ground the citations: dedupe and keep only names of documents that were
    // actually retrieved — the LLM cannot invent or garble a source label.
    const retrievedNames = new Set(records.map((record) => record.segment.document.name));
    const sources = [...new Set(result.sources)].filter((name) => retrievedNames.has(name));
    const saved = await respondWith(result.answer, sources);
    if (saved.inserted) await markRateLimitSuccess(req.userDbName!, "kbChat");
    res.status(200).json({ userMessage: saved.userMessage, message: saved.message });
  } catch (error) {
    if (!handleDifyError(res, error)) throw error;
  }
}

export async function clearKnowledgeChat(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  await getKbChatMessageModel(conn).deleteMany({});
  res.status(200).json({ ok: true });
}
