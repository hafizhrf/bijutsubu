import { Request, Response } from "express";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaDashboardModel } from "../models/metaDashboard.model.js";
import { guardIntent } from "../services/genUI.intentGuard.service.js";
import { generateUiSpec, reviseUiSpec } from "../services/genUI.specGenerator.service.js";
import type { DashboardChatMessage } from "../services/genUI.specGenerator.service.js";
import { executeUiSpec } from "../services/genUI.executor.service.js";
import { sanitizeUiSpecHtml } from "../services/genUI.htmlSanitizer.service.js";
import { markRateLimitSuccess } from "../middleware/rateLimit.js";
import { GridRectSchema, UiSpecSchema } from "../schemas/uiSpec.schema.js";
import { logActivity } from "../services/activityLog.service.js";
import {
  clearGenerationStage,
  getGenerationStage,
  setGenerationStage,
} from "../services/generationProgress.service.js";

const GeneratePromptSchema = z.object({
  prompt: z.string().min(1).max(2000),
  requestId: z.string().uuid(),
});

/**
 * The queue item id deterministically owns one dashboard inside a user's
 * physical database. Mongo's built-in unique _id index makes the final upsert
 * race-safe even if the same HTTP request is replayed while generation is
 * still running.
 */
function dashboardIdForRequest(requestId: string): mongoose.Types.ObjectId {
  const hex = createHash("sha256").update(requestId).digest("hex").slice(0, 24);
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

/** Fallback title when the LLM's uiSpec.title is empty: the prompt, trimmed to fit. */
function deriveTitleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  const truncated = compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

/**
 * Generates AND persists the dashboard in one step — every successful
 * generation lands in the saved list with an automatic title (the user can
 * rename it later via renameSavedDashboard).
 */
export async function generateDashboard(req: Request, res: Response) {
  const parsed = GeneratePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { prompt, requestId } = parsed.data;

  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboardId = dashboardIdForRequest(requestId);

  // A completed retry can return immediately without another LLM call.
  const existing = await MetaDashboard.findById(dashboardId).lean();
  if (existing) {
    if (existing.prompt !== prompt) {
      res.status(409).json({ error: "generation_request_id_reused" });
      return;
    }
    const existingUiSpec = UiSpecSchema.parse(existing.uiSpec);
    const data = await executeUiSpec(conn, existingUiSpec);
    res.status(200).json({
      dashboard: {
        _id: existing._id,
        title: existing.title,
        prompt: existing.prompt,
        createdAt: existing.createdAt,
      },
      uiSpec: existingUiSpec,
      data,
    });
    return;
  }

  try {
    setGenerationStage(requestId, "guarding");
    const guard = await guardIntent(prompt);
    if (!guard.allowed) {
      res.status(400).json({ rejected: true, reason: guard.reasonForUser, category: guard.category });
      return;
    }

    setGenerationStage(requestId, "designing");
    // Sanitized before saving so stored specs never contain executable markup.
    const uiSpec = sanitizeUiSpecHtml(await generateUiSpec(conn, prompt));
    setGenerationStage(requestId, "executing");
    const generatedData = await executeUiSpec(conn, uiSpec);
    setGenerationStage(requestId, "saving");
    await persistAndRespond(req, res, {
      conn,
      requestId,
      prompt,
      dashboardId,
      uiSpec,
      generatedData,
    });
  } finally {
    clearGenerationStage(requestId);
  }
}

interface PersistArgs {
  conn: ReturnType<typeof getUserConnection>;
  requestId: string;
  prompt: string;
  dashboardId: mongoose.Types.ObjectId;
  uiSpec: z.infer<typeof UiSpecSchema>;
  generatedData: Awaited<ReturnType<typeof executeUiSpec>>;
}

async function persistAndRespond(
  req: Request,
  res: Response,
  { conn, requestId, prompt, dashboardId, uiSpec, generatedData }: PersistArgs,
) {
  const MetaDashboard = getMetaDashboardModel(conn);
  const title = uiSpec.title?.trim() || deriveTitleFromPrompt(prompt);
  let inserted = false;
  try {
    const writeResult = await MetaDashboard.updateOne(
      { _id: dashboardId },
      {
        $setOnInsert: {
          generationRequestId: requestId,
          title,
          prompt,
          uiSpec,
          messages: [
            { role: "user", content: prompt },
            {
              role: "assistant",
              content: `Created "${title}" with ${uiSpec.widgets.length} widget${uiSpec.widgets.length === 1 ? "" : "s"}.`,
            },
          ],
        },
      },
      { upsert: true },
    );
    inserted = writeResult.upsertedCount === 1;
  } catch (error) {
    // Two upserts can reach Mongo before either sees the other's row. The _id
    // uniqueness guarantee still prevents duplication; the loser continues by
    // reading the winner's dashboard below.
    if (!isDuplicateKeyError(error)) throw error;
  }

  const dashboard = await MetaDashboard.findById(dashboardId).lean();
  if (!dashboard) {
    throw new Error("Generated dashboard was not found after idempotent upsert");
  }

  const persistedUiSpec = UiSpecSchema.parse(dashboard.uiSpec);
  const data = inserted ? generatedData : await executeUiSpec(conn, persistedUiSpec);

  // Only the request that actually inserted the dashboard consumes quota and
  // writes activity; concurrent replays return the same saved result.
  if (inserted) {
    await markRateLimitSuccess(req.userDbName!, "genui");
    logActivity(conn, "dashboard-generate", `Generated dashboard "${dashboard.title}"`, {
      dashboardId: String(dashboard._id),
      widgets: persistedUiSpec.widgets.length,
    });
  }

  res.status(200).json({
    dashboard: {
      _id: dashboard._id,
      title: dashboard.title,
      prompt: dashboard.prompt,
      createdAt: dashboard.createdAt,
    },
    uiSpec: persistedUiSpec,
    data,
  });
}

/**
 * Progress poll for an in-flight generation. 404 simply means "no stage
 * known" (finished, restarted instance, or other process) — the client
 * falls back to its indeterminate spinner.
 */
export async function getGenerationProgress(req: Request, res: Response) {
  const requestId = String(req.params.requestId);
  const stage = getGenerationStage(requestId);
  if (!stage) {
    res.status(404).json({ error: "no_progress" });
    return;
  }
  res.status(200).json({ stage });
}

export async function listSavedDashboards(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboards = await MetaDashboard.find()
    .select("_id title prompt createdAt")
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json({ dashboards });
}

export async function getSavedDashboard(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboard = await MetaDashboard.findById(id).lean();
  if (!dashboard) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }

  const uiSpec = dashboard.uiSpec as z.infer<typeof UiSpecSchema>;
  const data = await executeUiSpec(conn, uiSpec);

  res.status(200).json({
    _id: dashboard._id,
    title: dashboard.title,
    prompt: dashboard.prompt,
    createdAt: dashboard.createdAt,
    messages: dashboard.messages ?? [],
    uiSpec,
    data,
  });
}

const RefinePromptSchema = z.object({ prompt: z.string().min(1).max(2000) });

/**
 * Prompt-driven edit of a saved dashboard: revises the stored spec, re-runs
 * the queries, persists the new spec, and appends the exchange to the
 * dashboard's chat history.
 */
export async function refineSavedDashboard(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  const parsed = RefinePromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { prompt } = parsed.data;

  const guard = await guardIntent(prompt);
  if (!guard.allowed) {
    res.status(400).json({ rejected: true, reason: guard.reasonForUser, category: guard.category });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboard = await MetaDashboard.findById(id).lean();
  if (!dashboard) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }

  const currentSpec = dashboard.uiSpec as z.infer<typeof UiSpecSchema>;
  const history = (dashboard.messages ?? []) as DashboardChatMessage[];

  const revision = await reviseUiSpec(conn, currentSpec, history, prompt);
  const uiSpec = sanitizeUiSpecHtml(revision.uiSpec);
  const data = await executeUiSpec(conn, uiSpec);

  const newMessages = [
    { role: "user" as const, content: prompt },
    { role: "assistant" as const, content: revision.note },
  ];
  const updated = await MetaDashboard.findByIdAndUpdate(
    id,
    { $set: { uiSpec }, $push: { messages: { $each: newMessages } } },
    { new: true },
  ).lean();

  await markRateLimitSuccess(req.userDbName!, "genui");
  logActivity(conn, "dashboard-refine", `Updated dashboard "${dashboard.title}" via prompt`, {
    dashboardId: id,
  });

  res.status(200).json({
    uiSpec,
    data,
    note: revision.note,
    messages: updated?.messages ?? [],
  });
}

const UpdateLayoutSchema = z.object({
  layout: z.record(z.string().min(1).max(100), GridRectSchema),
});

/**
 * Layout-only update: copies validated {x,y,w,h} rects into the `grid` slot
 * of widgets the server already holds. Nothing else from the request body is
 * ever written, so the client cannot mutate queries, widget types, or
 * content through this endpoint. No rate limit — no LLM involved.
 */
export async function updateDashboardLayout(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  const parsed = UpdateLayoutSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data.layout).length === 0) {
    res.status(400).json({ error: "invalid_input", details: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  if (Object.keys(parsed.data.layout).length > 64) {
    res.status(400).json({ error: "invalid_input", details: "too many layout entries" });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboard = await MetaDashboard.findById(id).lean();
  if (!dashboard) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }

  const uiSpec = UiSpecSchema.parse(dashboard.uiSpec);
  const knownIds = new Set(uiSpec.widgets.map((w) => w.id));
  const unknown = Object.keys(parsed.data.layout).filter((widgetId) => !knownIds.has(widgetId));
  if (unknown.length > 0) {
    res.status(400).json({ error: "unknown_widget_ids", widgetIds: unknown });
    return;
  }

  for (const widget of uiSpec.widgets) {
    const rect = parsed.data.layout[widget.id];
    if (rect) widget.grid = rect;
  }

  await MetaDashboard.updateOne({ _id: id }, { $set: { uiSpec } });
  logActivity(conn, "dashboard-layout", `Rearranged dashboard "${dashboard.title}"`, {
    dashboardId: id,
  });
  res.status(200).json({ ok: true, uiSpec });
}

const RenameDashboardSchema = z.object({ title: z.string().min(1).max(200) });

export async function renameSavedDashboard(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  const parsed = RenameDashboardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboard = await MetaDashboard.findByIdAndUpdate(
    id,
    { $set: { title: parsed.data.title.trim() } },
    { new: true },
  ).lean();
  if (!dashboard) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  logActivity(conn, "dashboard-rename", `Renamed a dashboard to "${dashboard.title}"`);
  res.status(200).json({ ok: true, title: dashboard.title });
}

export async function deleteSavedDashboard(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const MetaDashboard = getMetaDashboardModel(conn);
  const dashboard = await MetaDashboard.findByIdAndDelete(id).lean();
  if (!dashboard) {
    res.status(404).json({ error: "dashboard_not_found" });
    return;
  }
  logActivity(conn, "dashboard-delete", `Deleted dashboard "${dashboard.title}"`);
  res.status(200).json({ ok: true });
}
