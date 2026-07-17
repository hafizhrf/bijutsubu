import { Connection, Schema } from "mongoose";

const kbChatMessageSchema = new Schema(
  {
    /** Stable client job id used to make chat retries idempotent. */
    requestId: { type: String },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    /** Document names the assistant grounded its answer on (assistant only). */
    sources: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: "_kb_chat_messages" },
);

kbChatMessageSchema.index({ createdAt: 1 });

export function getKbChatMessageModel(conn: Connection) {
  return conn.models.KbChatMessage ?? conn.model("KbChatMessage", kbChatMessageSchema);
}
