import { api } from "@/lib/api";
import type { GenerateInsightsResponse, OverviewResponse } from "@/types/overview";

export async function getOverview(): Promise<OverviewResponse> {
  const { data } = await api.get<OverviewResponse>("/overview");
  return data;
}

export async function generateInsights(requestId: string): Promise<GenerateInsightsResponse> {
  const { data } = await api.post<GenerateInsightsResponse>("/insights/generate", {
    requestId,
  });
  return data;
}
