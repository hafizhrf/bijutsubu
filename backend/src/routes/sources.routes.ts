import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  createSource,
  deleteSource,
  getSourceTables,
  listSources,
  syncSourceNow,
  testSource,
  updateSource,
} from "../controllers/sources.controller.js";

export const sourcesRouter = Router();
sourcesRouter.use(requireAuth);

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

sourcesRouter.post("/test", wrap(testSource));
sourcesRouter.post("/", wrap(createSource));
sourcesRouter.get("/", wrap(listSources));
sourcesRouter.get("/:id/tables", wrap(getSourceTables));
sourcesRouter.patch("/:id", wrap(updateSource));
sourcesRouter.delete("/:id", wrap(deleteSource));
// Manual sync sits behind the sourceSync cooldown; scheduled syncs don't.
sourcesRouter.post("/:id/sync", rateLimit("sourceSync"), wrap(syncSourceNow));
