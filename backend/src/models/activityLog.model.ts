import { Connection, Schema } from "mongoose";

/**
 * Per-user activity trail: one document per meaningful action (upload, row
 * edits, schema changes, relations, dashboard generations …). Entries expire
 * after 90 days so the collection can't grow unbounded.
 */
const activityLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    summary: { type: String, required: true },
    detail: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, index: true, expires: 90 * 24 * 3600 },
  },
  { timestamps: false, collection: "_activity_logs" },
);

export function getActivityLogModel(conn: Connection) {
  return conn.models.ActivityLog ?? conn.model("ActivityLog", activityLogSchema);
}
