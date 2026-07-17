import { Connection } from "mongoose";
import { getActivityLogModel } from "../models/activityLog.model.js";

/**
 * Fire-and-forget activity logging — a failed log write must never fail (or
 * slow down) the actual operation, so callers don't await this.
 */
export function logActivity(
  conn: Connection,
  action: string,
  summary: string,
  detail?: Record<string, unknown>,
): void {
  void getActivityLogModel(conn)
    .create({ action, summary, detail: detail ?? null })
    .catch((error) => {
      console.error("activity log write failed:", error);
    });
}
