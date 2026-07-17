import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { adminActivate, adminOverview, adminSuspend, adminUserDetail, adminUsers } from "../controllers/admin.controller.js";
export const adminRouter=Router(); adminRouter.use(requireAuth,requireAdmin); adminRouter.get("/overview",adminOverview); adminRouter.get("/users",adminUsers); adminRouter.get("/users/:id",adminUserDetail); adminRouter.post("/users/:id/suspend",adminSuspend); adminRouter.post("/users/:id/activate",adminActivate);