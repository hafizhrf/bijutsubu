import { Connection, Schema } from "mongoose";

/**
 * A connected external database server (MySQL/MariaDB, PostgreSQL, MongoDB)
 * that syncs selected tables into this user's workspace collections.
 * `encryptedPassword` is AES-GCM output from credentialVault — plaintext
 * credentials must never be stored, logged, or returned by any endpoint.
 */
const sourceTableSchema = new Schema(
  {
    sourceTable: { type: String, required: true },
    /** Workspace collection this table mirrors into (set on first sync). */
    targetCollection: { type: String, required: true },
    upsertKey: { type: String, default: null },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const metaSourceSchema = new Schema(
  {
    name: { type: String, required: true },
    engine: { type: String, enum: ["mysql", "postgres", "mongodb"], required: true },
    host: { type: String, required: true },
    port: { type: Number, required: true },
    database: { type: String, required: true },
    username: { type: String, default: "" },
    encryptedPassword: { type: String, default: "" },
    ssl: { type: Boolean, default: false },
    tables: { type: [sourceTableSchema], default: [] },
    /** 0 = manual only; otherwise the polling interval in minutes. */
    syncIntervalMinutes: { type: Number, default: 0 },
    lastSyncAt: { type: Date, default: null },
    lastSyncStatus: { type: String, enum: ["ok", "error", null], default: null },
    /** Stable error code (never a raw driver message). */
    lastSyncError: { type: String, default: null },
    lastSyncStats: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "_meta_sources" },
);

export function getMetaSourceModel(conn: Connection) {
  return conn.models.MetaSource ?? conn.model("MetaSource", metaSourceSchema);
}
