import { NextFunction, Request, Response } from "express";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getRateLimitRecordModel } from "../models/rateLimitRecord.model.js";
import { RATE_LIMIT_WINDOWS_MS, RateLimitedAction } from "../config/rateLimit.js";

/**
 * Checks (but does not write) the rate limit for `action`. Controllers must
 * explicitly call `markRateLimitSuccess` after the underlying operation truly
 * succeeds — this middleware never marks success itself, so rejected/failed
 * attempts (e.g. a blacklisted generative-UI prompt) never consume quota.
 */
export function rateLimit(action: RateLimitedAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userDbName) {
      res.status(401).json({ error: "missing_token" });
      return;
    }

    const retryAfterMs = await getRateLimitRetryAfter(req.userDbName, action);
    if (retryAfterMs !== null) {
      res.status(429).json({ error: "rate_limited", retryAfterMs });
      return;
    }

    next();
  };
}

export async function getRateLimitRetryAfter(
  dbName: string,
  action: RateLimitedAction,
): Promise<number | null> {
  const conn = getUserConnection(dbName);
  const RateLimitRecord = getRateLimitRecordModel(conn);
  const record = await RateLimitRecord.findOne({ action }).lean();
  if (!record) return null;

  const windowMs = RATE_LIMIT_WINDOWS_MS[action];
  const elapsed = Date.now() - new Date(record.lastSuccessAt).getTime();
  return elapsed < windowMs ? windowMs - elapsed : null;
}

export async function markRateLimitSuccess(dbName: string, action: RateLimitedAction) {
  const conn = getUserConnection(dbName);
  const RateLimitRecord = getRateLimitRecordModel(conn);
  await RateLimitRecord.findOneAndUpdate(
    { action },
    { $set: { lastSuccessAt: new Date() } },
    { upsert: true },
  );
}
