import { Connection, Schema } from "mongoose";

const metaRelationSchema = new Schema(
  {
    fromCollection: { type: String, required: true },
    toCollection: { type: String, required: true },
    fromField: { type: String, required: true },
    toField: { type: String, required: true },
    type: {
      type: String,
      enum: ["one-to-one", "one-to-many", "many-to-many"],
      required: true,
    },
    description: { type: String, required: true },
    createdVia: { type: String, enum: ["upload-instruction", "nl-prompt", "manual"], required: true },
  },
  { timestamps: true, collection: "_meta_relations" },
);

metaRelationSchema.index({ fromCollection: 1, toCollection: 1 });

export function getMetaRelationModel(conn: Connection) {
  return conn.models.MetaRelation ?? conn.model("MetaRelation", metaRelationSchema);
}
