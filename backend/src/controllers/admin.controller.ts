import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { User } from "../models/User.js";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { getMetaDashboardModel } from "../models/metaDashboard.model.js";
import { getMetaSourceModel } from "../models/metaSource.model.js";
import { getActivityLogModel } from "../models/activityLog.model.js";

const PAGE_SIZE = 20;
const SuspendSchema = z.object({ reason: z.string().trim().min(3).max(300) });
async function workspace(user: { dbName: string }) {
  const conn = getUserConnection(user.dbName);
  const [collections, dashboards, sources, recentActivity] = await Promise.all([
    getMetaCollectionModel(conn).find().select("rowCount").lean(),
    getMetaDashboardModel(conn).countDocuments(),
    getMetaSourceModel(conn).find().select("name engine database port lastSyncAt lastSyncStatus lastSyncError tables").lean(),
    getActivityLogModel(conn).find().sort({ createdAt: -1 }).limit(6).select("action summary createdAt").lean(),
  ]);
  return { metrics: { collections: collections.length, rows: collections.reduce((sum, c) => sum + c.rowCount, 0), dashboards, sources: sources.length }, sources: sources.map(s => ({ id: String(s._id), name: s.name, engine: s.engine, database: s.database, port: s.port, lastSyncAt: s.lastSyncAt, lastSyncStatus: s.lastSyncStatus, lastSyncError: s.lastSyncError, tableCount: s.tables.filter((t: { enabled: boolean }) => t.enabled).length })), recentActivity };
}
function safeUser(user: any) { return { id: String(user._id), email: user.email, displayName: user.displayName || user.email.split("@")[0], createdAt: user.createdAt, suspendedAt: user.suspendedAt ?? null, suspensionReason: user.suspensionReason ?? null }; }
export async function adminOverview(_req: Request, res: Response) { const users = await User.find().sort({ createdAt: -1 }).lean(); const profiles = await Promise.all(users.map(async user => ({ user, workspace: await workspace(user) }))); const sourceHealth = profiles.flatMap(({ user, workspace }) => workspace.sources.map(source => ({ user: safeUser(user), source }))); const sources = sourceHealth.filter(({ source }) => source.lastSyncStatus === "error"); res.json({ metrics: { users: users.length, suspendedUsers: users.filter(u => u.suspendedAt).length, collections: profiles.reduce((n,p) => n+p.workspace.metrics.collections,0), dashboards: profiles.reduce((n,p) => n+p.workspace.metrics.dashboards,0), sources: profiles.reduce((n,p) => n+p.workspace.metrics.sources,0), sourceErrors: sources.length }, recentUsers: profiles.slice(0,6).map(({user,workspace})=>({user:safeUser(user),metrics:workspace.metrics})), failingSources: sources.slice(0,20), sourceHealth: sourceHealth.slice(0,100), suspendedAccounts: profiles.filter(({ user }) => user.suspendedAt).map(({ user }) => safeUser(user)) }); }
export async function adminUsers(req: Request, res: Response) { const query = typeof req.query.q === "string" ? req.query.q.trim() : ""; const page = Math.max(1, Number(req.query.page) || 1); const filter = query ? { $or: [{ email: { $regex: query, $options: "i" } }, { displayName: { $regex: query, $options: "i" } }] } : {}; const [total, users] = await Promise.all([User.countDocuments(filter), User.find(filter).sort({ createdAt:-1 }).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).lean()]); const items = await Promise.all(users.map(async user => ({ user:safeUser(user), metrics:(await workspace(user)).metrics }))); res.json({ items, page, pageSize: PAGE_SIZE, total }); }
export async function adminUserDetail(req: Request,res: Response) { const user = await User.findById(req.params.id).lean(); if(!user){res.status(404).json({error:"user_not_found"});return;} res.json({ user:safeUser(user), ...(await workspace(user)) }); }
export async function adminSuspend(req: Request,res: Response) { const parsed=SuspendSchema.safeParse(req.body); if(!parsed.success){res.status(400).json({error:"invalid_input"});return;} if(req.params.id===req.userId){res.status(400).json({error:"cannot_suspend_self"});return;} const user=await User.findByIdAndUpdate(req.params.id,{$set:{suspendedAt:new Date(),suspensionReason:parsed.data.reason,suspendedBy:req.userId}},{new:true}).lean(); if(!user){res.status(404).json({error:"user_not_found"});return;} res.json({user:safeUser(user)}); }
export async function adminActivate(req: Request,res: Response) { const user=await User.findByIdAndUpdate(req.params.id,{$set:{suspendedAt:null,suspensionReason:null,suspendedBy:null}},{new:true}).lean(); if(!user){res.status(404).json({error:"user_not_found"});return;} res.json({user:safeUser(user)}); }