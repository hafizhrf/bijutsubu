import { Connection, Schema } from "mongoose";

const insightItemSchema = new Schema(
  {
    severity: { type: String, enum: ["info", "opportunity", "warning"], required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    collectionName: { type: String, default: null },
    action: {
      type: String,
      enum: ["open-collection", "import-data", "create-dashboard", "open-knowledge", "none"],
      required: true,
    },
  },
  { _id: false },
);

const metaInsightSnapshotSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true },
    dataFingerprint: { type: String, required: true },
    summary: { type: String, required: true },
    items: { type: [insightItemSchema], default: [] },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: "_meta_insight_snapshots" },
);

export function getMetaInsightSnapshotModel(conn: Connection) {
  return (
    conn.models.MetaInsightSnapshot ??
    conn.model("MetaInsightSnapshot", metaInsightSnapshotSchema)
  );
}
