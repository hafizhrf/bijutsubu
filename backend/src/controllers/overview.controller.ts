import { createHash } from "node:crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaRelationModel } from "../models/metaRelation.model.js";
import { getMetaDashboardModel } from "../models/metaDashboard.model.js";
import { getActivityLogModel } from "../models/activityLog.model.js";
import { getMetaInsightSnapshotModel } from "../models/metaInsightSnapshot.model.js";
import { getMetaSourceModel } from "../models/metaSource.model.js";
import { getUserDatasetId } from "../services/kbDataset.service.js";
import { listDocuments } from "../services/difyClient.service.js";
import { completeJSON } from "../services/llmClient.service.js";
import { getRateLimitRetryAfter, markRateLimitSuccess } from "../middleware/rateLimit.js";
import { logActivity } from "../services/activityLog.service.js";

const InsightRequestSchema = z.object({ requestId: z.string().uuid() });
const AiInsightSchema = z.object({
  summary: z.string().min(1).max(500),
  items: z
    .array(
      z.object({
        severity: z.enum(["info", "opportunity", "warning"]),
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        collectionName: z.string().nullable(),
        action: z.enum([
          "open-collection",
          "import-data",
          "create-dashboard",
          "open-knowledge",
          "none",
        ]),
      }),
    )
    .max(5),
});

const AI_SYSTEM_PROMPT = `You are a data workspace analyst. Analyze ONLY the supplied aggregate metadata.
Never invent values, trends, collections, or business facts. Prefer useful, specific observations over generic advice.
Return JSON only with this exact shape: {"summary": string, "items": [{"severity":"info"|"opportunity"|"warning","title":string,"description":string,"collectionName":string|null,"action":"open-collection"|"import-data"|"create-dashboard"|"open-knowledge"|"none"}]}.
Return at most 5 items. Use the same language as the supplied deterministic findings.`;

type Finding = {
  id: string;
  severity: "info" | "opportunity" | "warning";
  title: string;
  description: string;
  action: { label: string; to: string } | null;
};

async function buildWorkspaceProfile(dbName: string, userId: string) {
  const conn = getUserConnection(dbName);
  const Collection = getMetaCollectionModel(conn);
  const Relation = getMetaRelationModel(conn);
  const Dashboard = getMetaDashboardModel(conn);
  const Activity = getActivityLogModel(conn);
  const InsightSnapshot = getMetaInsightSnapshotModel(conn);
  const Source = getMetaSourceModel(conn);
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const [collections, relations, dashboardCount, recentActivity, currentActivity, previousActivity, latestSnapshot, sources] =
    await Promise.all([
      Collection.find().sort({ updatedAt: -1 }).lean(),
      Relation.find().lean(),
      Dashboard.countDocuments(),
      Activity.find().sort({ createdAt: -1 }).limit(6).lean(),
      Activity.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Activity.countDocuments({ createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } }),
      InsightSnapshot.findOne().sort({ generatedAt: -1 }).lean(),
      Source.find().select("name lastSyncStatus").lean(),
    ]);

  const failingSources = sources.filter((source) => source.lastSyncStatus === "error");
  const sourcesStatus: "none" | "ok" | "error" =
    sources.length === 0 ? "none" : failingSources.length > 0 ? "error" : "ok";

  let knowledgeDocuments: number | null = 0;
  let knowledgeStatus: "ready" | "empty" | "unavailable" = "empty";
  try {
    const datasetId = await getUserDatasetId(userId);
    if (datasetId) {
      const result = await listDocuments(datasetId, { page: 1, limit: 1 });
      knowledgeDocuments = result.total;
      knowledgeStatus = "ready";
    }
  } catch {
    knowledgeDocuments = null;
    knowledgeStatus = "unavailable";
  }

  const relationCollections = new Set(
    relations.flatMap((relation) => [relation.fromCollection, relation.toCollection]),
  );
  const totalRows = collections.reduce((sum, collection) => sum + collection.rowCount, 0);
  const staleThreshold = now - 30 * 24 * 60 * 60 * 1000;
  const findings: Finding[] = [];

  if (collections.length === 0) {
    findings.push({
      id: "no-data",
      severity: "opportunity",
      title: "Start with your first dataset",
      description: "Import a document to create structured data you can explore and visualize.",
      action: { label: "Import data", to: "/documents" },
    });
  } else {
    const empty = collections.filter((collection) => collection.rowCount === 0);
    if (empty.length > 0) {
      findings.push({
        id: "empty-collections",
        severity: "warning",
        title: `${empty.length} empty collection${empty.length === 1 ? "" : "s"}`,
        description: "Empty collections cannot contribute to dashboards or useful analysis.",
        action: { label: "Review collections", to: "/collections" },
      });
    }
    const stale = collections.filter((collection) => {
      const date = collection.lastAppendedAt ?? collection.sourceFile?.uploadedAt ?? collection.updatedAt;
      return date && new Date(date).getTime() < staleThreshold;
    });
    if (stale.length > 0) {
      findings.push({
        id: "stale-data",
        severity: "info",
        title: `${stale.length} collection${stale.length === 1 ? "" : "s"} not updated in 30 days`,
        description: "Review whether these datasets still represent the latest source information.",
        action: { label: "Review data", to: "/collections" },
      });
    }
    const unconnected = collections.filter((collection) => !relationCollections.has(collection.name));
    if (collections.length > 1 && unconnected.length > 0) {
      findings.push({
        id: "unconnected-data",
        severity: "opportunity",
        title: `${unconnected.length} collection${unconnected.length === 1 ? " is" : "s are"} unconnected`,
        description: "Relations can unlock joined analysis across otherwise isolated datasets.",
        action: { label: "Map relations", to: "/collections?tab=relations" },
      });
    }
    if (dashboardCount === 0 && totalRows > 0) {
      findings.push({
        id: "no-dashboard",
        severity: "opportunity",
        title: "Your data is ready for a dashboard",
        description: `${totalRows.toLocaleString()} rows are available but no dashboard has been saved yet.`,
        action: { label: "Create dashboard", to: "/dashboard" },
      });
    }
  }

  if (failingSources.length > 0) {
    findings.push({
      id: "source-sync-failing",
      severity: "warning",
      title: `${failingSources.length} data source${failingSources.length === 1 ? " is" : "s are"} failing to sync`,
      description: "Connected collections keep their last synced data until the connection is fixed.",
      action: { label: "Review sources", to: "/documents?tab=sources" },
    });
  }

  if (currentActivity > previousActivity && previousActivity > 0) {
    const increase = Math.round(((currentActivity - previousActivity) / previousActivity) * 100);
    findings.push({
      id: "activity-growth",
      severity: "info",
      title: `Workspace activity is up ${increase}%`,
      description: "This compares the last 7 days with the preceding 7-day period.",
      action: { label: "View activity", to: "/logs" },
    });
  }

  const fingerprintPayload = {
    collections: collections.map((collection) => ({
      name: collection.name,
      rows: collection.rowCount,
      fields: collection.fields.length,
      updatedAt: collection.updatedAt,
    })),
    relations: relations.length,
    dashboards: dashboardCount,
    knowledgeDocuments,
    activity: currentActivity,
  };
  const dataFingerprint = createHash("sha256")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex");

  return {
    metrics: {
      collections: collections.length,
      rows: totalRows,
      relations: relations.length,
      dashboards: dashboardCount,
      knowledgeDocuments,
    },
    findings: findings.slice(0, 5),
    recentActivity,
    serviceStatus: { knowledge: knowledgeStatus, sources: sourcesStatus },
    aiSnapshot: latestSnapshot
      ? {
          requestId: latestSnapshot.requestId,
          summary: latestSnapshot.summary,
          items: latestSnapshot.items,
          generatedAt: latestSnapshot.generatedAt,
          dataFingerprint: latestSnapshot.dataFingerprint,
          stale: latestSnapshot.dataFingerprint !== dataFingerprint,
        }
      : null,
    dataFingerprint,
    llmInput: {
      metrics: fingerprintPayload,
      collections: collections.map((collection) => ({
        name: collection.name,
        displayName: collection.displayName,
        rows: collection.rowCount,
        fields: collection.fields.map((field: { name: string; type: string }) => ({
          name: field.name,
          type: field.type,
        })),
        lastUpdated: collection.lastAppendedAt ?? collection.updatedAt,
      })),
      deterministicFindings: findings.map(({ title, description }) => ({ title, description })),
    },
    validCollectionNames: new Set(collections.map((collection) => collection.name)),
  };
}

export async function getOverview(req: Request, res: Response) {
  const profile = await buildWorkspaceProfile(req.userDbName!, req.userId!);
  res.status(200).json({
    metrics: profile.metrics,
    findings: profile.findings,
    recentActivity: profile.recentActivity,
    serviceStatus: profile.serviceStatus,
    aiSnapshot: profile.aiSnapshot,
    dataFingerprint: profile.dataFingerprint,
  });
}

export async function generateInsights(req: Request, res: Response) {
  const parsed = InsightRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const conn = getUserConnection(req.userDbName!);
  const InsightSnapshot = getMetaInsightSnapshotModel(conn);
  const existing = await InsightSnapshot.findOne({ requestId: parsed.data.requestId }).lean();
  if (existing) {
    res.status(200).json({ snapshot: existing });
    return;
  }

  const retryAfterMs = await getRateLimitRetryAfter(req.userDbName!, "insight");
  if (retryAfterMs !== null) {
    res.status(429).json({ error: "rate_limited", retryAfterMs });
    return;
  }

  const profile = await buildWorkspaceProfile(req.userDbName!, req.userId!);
  const generated = await completeJSON(
    AI_SYSTEM_PROMPT,
    `Workspace aggregate profile:\n${JSON.stringify(profile.llmInput)}`,
    AiInsightSchema,
  );
  const items = generated.items.map((item) => {
    const validCollection =
      item.collectionName !== null && profile.validCollectionNames.has(item.collectionName);
    return {
      ...item,
      collectionName: validCollection ? item.collectionName : null,
      action: item.action === "open-collection" && !validCollection ? ("none" as const) : item.action,
    };
  });

  let snapshot;
  let inserted = false;
  try {
    snapshot = await InsightSnapshot.create({
      requestId: parsed.data.requestId,
      dataFingerprint: profile.dataFingerprint,
      summary: generated.summary,
      items,
      generatedAt: new Date(),
    });
    inserted = true;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) {
      throw error;
    }
    snapshot = await InsightSnapshot.findOne({ requestId: parsed.data.requestId });
  }
  if (!snapshot) throw new Error("Insight snapshot missing after idempotent write");
  if (inserted) {
    await markRateLimitSuccess(req.userDbName!, "insight");
    logActivity(conn, "dashboard-insight", "Generated a workspace insight snapshot");
  }
  res.status(200).json({ snapshot });
}
