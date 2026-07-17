import { User } from "../models/User.js";
import { createDataset } from "./difyClient.service.js";

/**
 * Resolves (lazily creating) the user's private Dify dataset. The dataset id
 * is stored on the control-plane User document and is never accepted from a
 * request — the same trust model as dbName, so one user can never target
 * another user's knowledge base.
 */
export async function ensureUserDataset(userId: string): Promise<string> {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("user_not_found");
  if (user.difyDatasetId) return user.difyDatasetId;

  const created = await createDataset(`kb_user_${userId}`);
  // Conditional update guards the race where two first-uploads run at once:
  // only the winner persists its dataset id; the loser re-reads and uses the
  // stored one (its own freshly-created dataset stays as a harmless orphan).
  await User.updateOne(
    { _id: userId, difyDatasetId: { $exists: false } },
    { $set: { difyDatasetId: created.id } },
  );
  const fresh = await User.findById(userId).lean();
  return fresh?.difyDatasetId ?? created.id;
}

/** Dataset id for read paths — null when the user never uploaded anything. */
export async function getUserDatasetId(userId: string): Promise<string | null> {
  const user = await User.findById(userId).lean();
  return user?.difyDatasetId ?? null;
}
