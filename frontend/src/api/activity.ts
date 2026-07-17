import { api } from "@/lib/api";

export interface ActivityEntry {
  _id: string;
  action: string;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
  skip: number;
  limit: number;
}

/** prefix filters by category ("document", "row", "field", "collection", "relation", "dashboard"). */
export async function getActivity(
  { skip = 0, limit = 50, prefix = "" }: { skip?: number; limit?: number; prefix?: string } = {},
): Promise<ActivityResponse> {
  const { data } = await api.get<ActivityResponse>("/activity", {
    params: { skip, limit, ...(prefix ? { prefix } : {}) },
  });
  return data;
}
