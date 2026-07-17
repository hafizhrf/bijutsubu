import { Connection, Schema } from "mongoose";

/**
 * A saved NL custom table (mirrors the metaDashboard pattern): the prompt,
 * the LLM's title/columns, and the validated QueryDSL. Rows are never stored
 * — opening a saved table re-executes the DSL live, like saved dashboards.
 */
const metaCustomTableSchema = new Schema(
  {
    name: { type: String, required: true },
    prompt: { type: String, required: true },
    title: { type: String, required: true },
    columns: {
      type: [new Schema({ field: String, label: String }, { _id: false })],
      required: true,
    },
    queryDsl: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: "_meta_custom_tables" },
);

export function getMetaCustomTableModel(conn: Connection) {
  return conn.models.MetaCustomTable ?? conn.model("MetaCustomTable", metaCustomTableSchema);
}
