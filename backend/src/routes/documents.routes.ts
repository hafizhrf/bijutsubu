import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { uploadSingleFile } from "../middleware/upload.js";
import { applyUpload, cancelUpload, planUpload } from "../controllers/documents.controller.js";

export const documentsRouter = Router();

function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadSingleFile(req, res, (err: unknown) => {
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

// Both rate limits are checked here: uploadPlan throttles the LLM planning
// call itself, and checking upload up-front avoids staging a pending decision
// the user couldn't apply until the write cooldown has passed anyway.
documentsRouter.post(
  "/upload/plan",
  requireAuth,
  rateLimit("uploadPlan"),
  rateLimit("upload"),
  handleUpload,
  wrap(planUpload),
);

documentsRouter.post("/upload/:pendingId/apply", requireAuth, rateLimit("upload"), wrap(applyUpload));

documentsRouter.delete("/upload/:pendingId", requireAuth, wrap(cancelUpload));
