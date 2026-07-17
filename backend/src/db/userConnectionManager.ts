import mongoose, { Connection } from "mongoose";
import { env } from "../config/env.js";

const DB_NAME_PATTERN = /^user_[a-f0-9]{24}$/;

const connectionPool = new Map<string, Connection>();

/**
 * Returns a cached (or newly created) Mongoose connection scoped to a single
 * user's database. `dbName` must already be the server-derived value from the
 * User document — callers must never accept this from client input directly.
 */
export function getUserConnection(dbName: string): Connection {
  if (!DB_NAME_PATTERN.test(dbName)) {
    throw new Error(`Refusing to connect to invalid user database name: ${dbName}`);
  }

  const cached = connectionPool.get(dbName);
  if (cached) return cached;

  const connection = mongoose.createConnection(`${env.MONGODB_URI}/${dbName}`);
  connectionPool.set(dbName, connection);
  return connection;
}

export function deriveDbName(userId: string): string {
  return `user_${userId}`;
}
