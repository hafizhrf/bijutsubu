import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listActivity } from "../controllers/activity.controller.js";

export const activityRouter = Router();

activityRouter.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await listActivity(req, res);
  } catch (err) {
    next(err);
  }
});
