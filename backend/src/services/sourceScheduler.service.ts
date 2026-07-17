import { User } from "../models/User.js";
import { getUserConnection } from "../db/userConnectionManager.js";
import { getMetaSourceModel } from "../models/metaSource.model.js";
import { logActivity } from "./activityLog.service.js";
import { runSourceSync } from "./sourceSync.service.js";

/**
 * Polling scheduler for connected data sources: every SCAN_INTERVAL it walks
 * all users and syncs sources whose interval has elapsed. Sequential (one
 * sync at a time process-wide) and lock-guarded against manual "Sync now".
 *
 * In-memory + single-process, like generationProgress: a restart merely
 * delays the next poll; correctness never depends on the scheduler (users can
 * always sync manually). On multi-instance deployments each instance would
 * poll independently — the per-source run lock is per-process, so pin the
 * scheduler to one instance before scaling out.
 */

const SCAN_INTERVAL_MS = 60_000;

let scanning = false;

async function scanOnce(): Promise<void> {
  const users = await User.find().select("dbName").lean();
  for (const user of users) {
    let conn;
    try {
      conn = getUserConnection(user.dbName);
    } catch {
      continue;
    }
    const MetaSource = getMetaSourceModel(conn);
    const now = Date.now();
    const sources = await MetaSource.find({ syncIntervalMinutes: { $gt: 0 } }).lean();
    for (const source of sources) {
      const intervalMs = Number(source.syncIntervalMinutes) * 60_000;
      const last = source.lastSyncAt ? new Date(source.lastSyncAt as Date).getTime() : 0;
      if (now - last < intervalMs) continue;
      try {
        const result = await runSourceSync(user.dbName, conn, source as never);
        if (result?.ok) {
          const totalRows = result.tables.reduce((sum, table) => sum + table.rows, 0);
          logActivity(
            conn,
            "source-sync",
            `Auto-synced "${source.name}" — ${result.tables.filter((t) => t.status === "ok").length} tables, ${totalRows} rows`,
            { sourceId: String(source._id), scheduled: true },
          );
        }
      } catch {
        // syncSource records per-source error state; the scheduler never dies.
      }
    }
  }
}

export function startSourceScheduler(): void {
  const timer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void scanOnce()
      .catch(() => {})
      .finally(() => {
        scanning = false;
      });
  }, SCAN_INTERVAL_MS);
  // Never keep the process alive just for polling.
  timer.unref();
}
