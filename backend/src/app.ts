import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { collectionsRouter } from "./routes/collections.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { activityRouter } from "./routes/activity.routes.js";
import { knowledgeRouter } from "./routes/knowledge.routes.js";
import { overviewRouter } from "./routes/overview.routes.js";
import { insightsRouter } from "./routes/insights.routes.js";
import { sourcesRouter } from "./routes/sources.routes.js";
import { adminRouter } from "./routes/admin.routes.js";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/activity", activityRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/sources", sourcesRouter);
app.use("/api/admin", adminRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});
