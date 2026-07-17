import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { generateInsights } from "../controllers/overview.controller.js";

export const insightsRouter = Router();
insightsRouter.use(requireAuth);
insightsRouter.post("/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await generateInsights(req, res);
  } catch (error) {
    next(error);
  }
});
