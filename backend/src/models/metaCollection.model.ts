import { Connection, Schema } from "mongoose";

const fieldDefSchema = new Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["string", "number", "boolean", "date", "array", "object"],
      required: true,
    },
    sample: { type: Schema.Types.Mixed },
    nullable: { type: Boolean, default: false },
  },
  { _id: false },
);

const metaCollectionSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    fields: { type: [fieldDefSchema], default: [] },
    sourceFile: {
      originalName: { type: String, required: true },
      mimetype: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
      uploadedAt: { type: Date, required: true },
    },
    createdVia: { type: String, enum: ["auto", "instruction"], required: true },
    instructionText: { type: String, default: null },
    upsertKey: { type: String, default: null },
    rowCount: { type: Number, default: 0 },
    lastAppendedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "_meta_collections" },
);

export function getMetaCollectionModel(conn: Connection) {
  return conn.models.MetaCollection ?? conn.model("MetaCollection", metaCollectionSchema);
}
