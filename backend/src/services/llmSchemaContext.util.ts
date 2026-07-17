/**
 * Compact, one-line-per-item encodings of the user's schema for LLM prompts.
 * Pretty-printed JSON burns 2-3x the tokens of these lines, which matters as
 * a user's collection count grows — and a terse "universe of valid names"
 * grounds the model at least as well as verbose JSON.
 */

const TYPE_ABBREV: Record<string, string> = {
  string: "str",
  number: "num",
  boolean: "bool",
  date: "date",
  array: "arr",
  object: "obj",
};

export interface CollectionContext {
  name: string;
  displayName: string;
  rowCount?: number;
  fields: { name: string; type: string; nullable?: boolean }[];
}

export interface RelationContext {
  fromCollection: string;
  toCollection: string;
  fromField: string;
  toField: string;
  type: string;
  description?: string;
}

/** e.g. `sales_records "Sales Records" (10000 rows): Region:str?, Order ID:num` */
export function formatCollectionLine(collection: CollectionContext): string {
  const fields = collection.fields
    .map(
      (f) =>
        `${f.name}:${TYPE_ABBREV[f.type] ?? f.type}${f.nullable === false ? "" : "?"}`,
    )
    .join(", ");
  const rows =
    collection.rowCount !== undefined ? ` (${collection.rowCount} rows)` : "";
  return `${collection.name} "${collection.displayName}"${rows}: ${fields || "(no fields)"}`;
}

/** Legend line + one line per collection; "(none)" when empty. */
export function formatCollectionsContext(collections: CollectionContext[]): string {
  if (collections.length === 0) return "(none)";
  return [
    `(format: name "Display Name" (row count): field:type — "?" marks nullable; every collection also has _id)`,
    ...collections.map(formatCollectionLine),
  ].join("\n");
}

/** e.g. `orders.customer_id -> customers._id (one-to-many) — each order has a customer` */
export function formatRelationsContext(relations: RelationContext[]): string {
  if (relations.length === 0) return "(none)";
  return relations
    .map(
      (r) =>
        `${r.fromCollection}.${r.fromField} -> ${r.toCollection}.${r.toField} (${r.type})${
          r.description ? ` — ${r.description}` : ""
        }`,
    )
    .join("\n");
}
