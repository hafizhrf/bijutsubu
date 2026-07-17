import { Connection, Schema } from "mongoose";

const chatMessageSchema = new Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const metaDashboardSchema = new Schema(
  {
    /** Stable client queue id used to make generation retries idempotent. */
    generationRequestId: { type: String },
    title: { type: String, required: true },
    prompt: { type: String, required: true },
    uiSpec: { type: Schema.Types.Mixed, required: true },
    /** Prompt-edit conversation: the original request plus every refinement. */
    messages: { type: [chatMessageSchema], default: [] },
  },
  { timestamps: true, collection: "_meta_dashboards" },
);

export function getMetaDashboardModel(conn: Connection) {
  return conn.models.MetaDashboard ?? conn.model("MetaDashboard", metaDashboardSchema);
}
