import { Connection, Schema } from "mongoose";

/**
 * Server-side staging for the two-phase upload flow: the plan endpoint parses
 * the file and stores the plan + extracted rows here, and the apply endpoint
 * later writes them once the user has picked merge/skip/create-new. Rows are
 * chunked into a companion collection so a large CSV never hits the 16MB BSON
 * document cap. Both collections carry a TTL so abandoned decisions clean
 * themselves up (apply also checks expiresAt manually — Mongo's TTL sweep can
 * lag by up to a minute).
 */

export const PENDING_UPLOAD_TTL_MS = 30 * 60_000;
export const PENDING_UPLOAD_ROWS_PER_CHUNK = 2000;

const pendingUploadSchema = new Schema(
  {
    plan: { type: Schema.Types.Mixed, required: true },
    sourceFile: {
      originalName: { type: String, required: true },
      mimetype: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
    },
    instruction: { type: String, default: null },
    similarCollections: { type: Schema.Types.Mixed, default: [] },
    preview: { type: Schema.Types.Mixed, required: true },
    rowCount: { type: Number, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true, collection: "_meta_pending_uploads" },
);

const pendingUploadRowsSchema = new Schema(
  {
    pendingId: { type: Schema.Types.ObjectId, required: true, index: true },
    seq: { type: Number, required: true },
    rows: { type: [Schema.Types.Mixed], required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: false, collection: "_meta_pending_upload_rows" },
);

export function getPendingUploadModel(conn: Connection) {
  return conn.models.PendingUpload ?? conn.model("PendingUpload", pendingUploadSchema);
}

export function getPendingUploadRowsModel(conn: Connection) {
  return (
    conn.models.PendingUploadRows ?? conn.model("PendingUploadRows", pendingUploadRowsSchema)
  );
}
