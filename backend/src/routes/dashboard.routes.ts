import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  deleteSavedDashboard,
  generateDashboard,
  getGenerationProgress,
  getSavedDashboard,
  listSavedDashboards,
  refineSavedDashboard,
  renameSavedDashboard,
  updateDashboardLayout,
} from "../controllers/dashboard.controller.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// Generation auto-saves — there is no separate manual save endpoint.
dashboardRouter.post("/generate", rateLimit("genui"), generateDashboard);
// Progress poll for an in-flight generation (no LLM, no rate limit).
dashboardRouter.get("/generate/:requestId/progress", getGenerationProgress);
dashboardRouter.get("/saved", listSavedDashboards);
dashboardRouter.get("/saved/:id", getSavedDashboard);
dashboardRouter.post("/saved/:id/refine", rateLimit("genui"), refineSavedDashboard);
dashboardRouter.patch("/saved/:id", renameSavedDashboard);
// Layout-only geometry update (no LLM, no rate limit).
dashboardRouter.patch("/saved/:id/layout", updateDashboardLayout);
dashboardRouter.delete("/saved/:id", deleteSavedDashboard);
