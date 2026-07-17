import { mysqlConnector } from "./mysqlConnector.js";
import { postgresConnector } from "./postgresConnector.js";
import { mongoConnector } from "./mongoConnector.js";
import { SourceConnector, SourceEngine } from "./types.js";

export * from "./types.js";

export function getConnector(engine: SourceEngine): SourceConnector {
  switch (engine) {
    case "mysql":
      return mysqlConnector;
    case "postgres":
      return postgresConnector;
    case "mongodb":
      return mongoConnector;
  }
}

/**
 * External column/field names are untrusted as Mongo keys ($-prefixes, dots)
 * and as workspace field names (FIELD_NAME_PATTERN). Existing guards only
 * REJECT bad keys — for sync we rename instead so real-world schemas import.
 */
const FIELD_NAME_SAFE = /[^a-zA-Z0-9_ \-/()]/g;

export function sanitizeSourceFieldName(raw: string): string {
  const cleaned = raw.replace(FIELD_NAME_SAFE, "_").slice(0, 64);
  return cleaned.length > 0 && cleaned !== "_id" ? cleaned : `field_${cleaned.length === 0 ? "x" : "id"}`;
}

/** Build an old→new rename map for a column list, deduping collisions. */
export function buildFieldRenameMap(names: string[]): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const name of names) {
    let next = sanitizeSourceFieldName(name);
    let suffix = 2;
    while (used.has(next)) next = `${sanitizeSourceFieldName(name)}_${suffix++}`;
    used.add(next);
    map.set(name, next);
  }
  return map;
}

/** Recursively make a value Mongo-safe: nested object keys with $/. renamed. */
export function sanitizeNestedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedKeys);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const safeKey = key.startsWith("$") || key.includes(".") ? key.replace(/^\$+/, "_").replace(/\./g, "_") : key;
      out[safeKey] = sanitizeNestedKeys(entry);
    }
    return out;
  }
  return value;
}
