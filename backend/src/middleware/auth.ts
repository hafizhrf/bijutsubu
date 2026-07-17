import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";

interface JwtPayload {
  sub: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  const token = header.slice("Bearer ".length);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  // Re-read the user's dbName from the DB on every request rather than trusting
  // anything from the token/client, so per-user isolation can't be spoofed.
  const user = await User.findById(payload.sub).lean();
  if (!user) {
    res.status(401).json({ error: "user_not_found" });
    return;
  }

  req.userId = user._id.toString();
  req.userDbName = user.dbName;
  next();
}
