import { Connection, Schema } from "mongoose";

const rateLimitRecordSchema = new Schema(
  {
    action: {
      type: String,
      enum: ["upload", "uploadPlan", "genui", "kbUpload", "kbChat"],
      required: true,
      unique: true,
    },
    lastSuccessAt: { type: Date, required: true },
  },
  { timestamps: false, collection: "_rate_limits" },
);

export function getRateLimitRecordModel(conn: Connection) {
  return conn.models.RateLimitRecord ?? conn.model("RateLimitRecord", rateLimitRecordSchema);
}
