import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { deriveDbName } from "../db/userConnectionManager.js";

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const ProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(8).max(200),
});

function userDto(user: {
  _id: mongoose.Types.ObjectId;
  email: string;
  displayName?: string | null;
  createdAt?: Date;
  suspendedAt?: Date | null;
}) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName?.trim() || user.email.split("@")[0],
    createdAt: user.createdAt ?? new Date(),
    isAdmin: env.ADMIN_EMAILS.includes(user.email.toLowerCase()),
    isSuspended: Boolean(user.suspendedAt),
  };
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export async function register(req: Request, res: Response) {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    res.status(409).json({ error: "email_already_registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const _id = new mongoose.Types.ObjectId();
  const user = await User.create({
    _id,
    email,
    displayName: email.split("@")[0],
    passwordHash,
    dbName: deriveDbName(_id.toString()),
  });

  const token = signToken(user._id.toString());
  res.status(201).json({ token, user: userDto(user) });
}

export async function login(req: Request, res: Response) {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  if (user.suspendedAt) { res.status(403).json({ error: "account_suspended" }); return; }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const token = signToken(user._id.toString());
  res.status(200).json({ token, user: userDto(user) });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.userId).lean();
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  res.status(200).json({ user: userDto(user) });
}

export async function updateProfile(req: Request, res: Response) {
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: { displayName: parsed.data.displayName } },
    { new: true },
  );
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  res.status(200).json({ user: userDto(user) });
}

export async function changePassword(req: Request, res: Response) {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "invalid_current_password" });
    return;
  }
  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await user.save();
  res.status(200).json({ ok: true });
}
