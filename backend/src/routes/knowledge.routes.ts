import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { kbUploadSingleFile } from "../middleware/upload.js";
import {
  clearKnowledgeChat,
  deleteKnowledgeDocument,
  getKnowledgeChat,
  getKnowledgeDocumentSegments,
  listKnowledgeDocuments,
  sendKnowledgeChat,
  uploadKnowledgeDocument,
} from "../controllers/knowledge.controller.js";

export const knowledgeRouter = Router();

knowledgeRouter.use(requireAuth);

function handleKbUpload(req: Request, res: Response, next: NextFunction) {
  kbUploadSingleFile(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "upload_failed";
      if (message === "unsupported_file_type") {
        res.status(415).json({ error: "unsupported_file_type" });
        return;
      }
      if (message.includes("File too large") || message.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "file_too_large" });
        return;
      }
      res.status(400).json({ error: "upload_failed" });
      return;
    }
    next();
  });
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  };
}

knowledgeRouter.get("/documents", wrap(listKnowledgeDocuments));
knowledgeRouter.post(
  "/documents",
  rateLimit("kbUpload"),
  handleKbUpload,
  wrap(uploadKnowledgeDocument),
);
knowledgeRouter.get("/documents/:docId/segments", wrap(getKnowledgeDocumentSegments));
knowledgeRouter.delete("/documents/:docId", wrap(deleteKnowledgeDocument));

knowledgeRouter.get("/chat", wrap(getKnowledgeChat));
knowledgeRouter.post("/chat", wrap(sendKnowledgeChat));
knowledgeRouter.delete("/chat", wrap(clearKnowledgeChat));
