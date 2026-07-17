import { Binary, Decimal128, Long, MongoClient, ObjectId } from "mongodb";
import { assertHostAllowed } from "./hostGuard.util.js";
import { SourceConfig, SourceConnector, SourceError, SourceFieldType, SourceTableInfo } from "./types.js";

/**
 * MongoDB connector. Field shapes are inferred from a document sample
 * (collections have no declared schema); the source `_id` is exposed as a
 * regular `source_id` string field so workspace documents keep their own ids.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const SAMPLE_SIZE = 50;

function mapError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const message = (error as Error)?.message ?? "";
  const name = (error as Error)?.name ?? "";
  if (/auth/i.test(message) || name === "MongoServerError" && /requires authentication|Authentication failed/i.test(message)) {
    return new SourceError("auth_failed");
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|getaddrinfo/i.test(message)) return new SourceError("unreachable");
  if (/timed? ?out/i.test(message) || name === "MongoServerSelectionError") return new SourceError("unreachable");
  return new SourceError("query_failed");
}

function inferType(value: unknown): SourceFieldType {
  if (typeof value === "number" || value instanceof Decimal128 || value instanceof Long) return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object" && !(value instanceof ObjectId) && !(value instanceof Binary)) return "object";
  return "string";
}

/** BSON-specific values → JSON-friendly ones the workspace can store/render. */
export function normalizeBsonValue(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128 || value instanceof Long) return Number(value.toString());
  if (value instanceof Binary) return value.toString("base64");
  if (Array.isArray(value)) return value.map(normalizeBsonValue);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = normalizeBsonValue(entry);
    return out;
  }
  return value;
}

async function withClient<T>(config: SourceConfig, fn: (client: MongoClient) => Promise<T>): Promise<T> {
  await assertHostAllowed(config.host);
  const client = new MongoClient(`mongodb://${config.host}:${config.port}`, {
    auth: config.username ? { username: config.username, password: config.password } : undefined,
    authSource: config.username ? config.database : undefined,
    tls: config.ssl || undefined,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    return await fn(client);
  } catch (error) {
    throw mapError(error);
  } finally {
    await client.close().catch(() => {});
  }
}

export const mongoConnector: SourceConnector = {
  async test(config) {
    await withClient(config, async (client) => {
      await client.db(config.database).command({ ping: 1 });
    });
  },

  async listTables(config) {
    return withClient(config, async (client) => {
      const db = client.db(config.database);
      const collections = await db
        .listCollections({ name: { $not: /^system\./ } }, { nameOnly: true })
        .toArray();
      const tables: SourceTableInfo[] = [];
      for (const collection of collections) {
        const sample = await db.collection(collection.name).find({}).limit(SAMPLE_SIZE).toArray();
        const types = new Map<string, SourceFieldType>();
        for (const doc of sample) {
          for (const [key, value] of Object.entries(doc)) {
            const field = key === "_id" ? "source_id" : key;
            if (!types.has(field)) types.set(field, key === "_id" ? "string" : inferType(value));
          }
        }
        tables.push({
          name: collection.name,
          columns: [...types.entries()].map(([name, type]) => ({ name, type })),
          pk: "source_id",
          fks: [],
          approxRows: await db.collection(collection.name).estimatedDocumentCount(),
        });
      }
      return tables;
    });
  },

  async fetchRows(config, table, limit) {
    return withClient(config, async (client) => {
      const db = client.db(config.database);
      const names = await db.listCollections({ name: table }, { nameOnly: true }).toArray();
      if (names.length === 0) throw new SourceError("table_not_found");
      const docs = await db.collection(table).find({}).limit(limit).toArray();
      return docs.map((doc) => {
        const { _id, ...rest } = doc;
        const row = normalizeBsonValue(rest) as Record<string, unknown>;
        return { source_id: _id instanceof ObjectId ? _id.toHexString() : String(_id), ...row };
      });
    });
  },
};
