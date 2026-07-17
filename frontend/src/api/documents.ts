import { api } from "@/lib/api";
import type { ApplyDecision, UploadApplied, UploadPlanResponse } from "@/types/collections";

/**
 * Phase 1 of the two-phase upload: parse + LLM plan. Clean uploads come back
 * already applied; ambiguous ones (similar collection, non-create action)
 * come back as "needs-decision" with a pendingId + preview.
 */
export async function planUpload(file: File, instruction: string): Promise<UploadPlanResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (instruction.trim()) {
    formData.append("instruction", instruction.trim());
  }
  const { data } = await api.post<UploadPlanResponse>("/documents/upload/plan", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/** Phase 2: execute a staged upload under the user's decision. */
export async function applyUpload(
  pendingId: string,
  decision: ApplyDecision,
): Promise<UploadApplied> {
  const { data } = await api.post<UploadApplied>(
    `/documents/upload/${encodeURIComponent(pendingId)}/apply`,
    decision,
  );
  return data;
}

/** Discards a staged upload (idempotent — expired/gone pendings are fine). */
export async function cancelUpload(pendingId: string): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(
    `/documents/upload/${encodeURIComponent(pendingId)}`,
  );
  return data;
}
