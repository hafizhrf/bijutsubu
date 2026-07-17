import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getOverview } from "../controllers/overview.controller.js";

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

overviewRouter.get("/", wrap(getOverview));
