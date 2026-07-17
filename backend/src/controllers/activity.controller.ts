import { Request, Response } from "express";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getActivityLogModel } from "../models/activityLog.model.js";

/** Category prefixes the frontend may filter by — never raw user regex. */
const ALLOWED_PREFIXES = new Set([
  "document",
  "row",
  "field",
  "collection",
  "relation",
  "dashboard",
]);

export async function listActivity(req: Request, res: Response) {
  const conn = getUserConnection(req.userDbName!);
  const ActivityLog = getActivityLogModel(conn);

  const skip = Math.max(Number(typeof req.query.skip === "string" ? req.query.skip : 0) || 0, 0);
  const limitRaw = Number(typeof req.query.limit === "string" ? req.query.limit : 50) || 50;
  const limit = Math.min(Math.max(limitRaw, 1), 200);
  const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";

  const filter = ALLOWED_PREFIXES.has(prefix)
    ? { action: { $regex: `^${prefix}-` } }
    : {};

  const [entries, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);

  res.status(200).json({ entries, total, skip, limit });
}
