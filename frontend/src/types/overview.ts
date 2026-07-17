import type { ActivityEntry } from "@/api/activity";

export type InsightSeverity = "info" | "opportunity" | "warning";

export interface OverviewFinding {
  id: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  action: { label: string; to: string } | null;
}

export interface AiInsightItem {
  severity: InsightSeverity;
  title: string;
  description: string;
  collectionName: string | null;
  action: "open-collection" | "import-data" | "create-dashboard" | "open-knowledge" | "none";
}

export interface InsightSnapshot {
  requestId: string;
  dataFingerprint: string;
  summary: string;
  items: AiInsightItem[];
  generatedAt: string;
  stale?: boolean;
}

export interface OverviewResponse {
  metrics: {
    collections: number;
    rows: number;
    relations: number;
    dashboards: number;
    knowledgeDocuments: number | null;
  };
  findings: OverviewFinding[];
  recentActivity: ActivityEntry[];
  serviceStatus: { knowledge: "ready" | "empty" | "unavailable" };
  aiSnapshot: InsightSnapshot | null;
  dataFingerprint: string;
}

export interface GenerateInsightsResponse {
  snapshot: InsightSnapshot;
}
