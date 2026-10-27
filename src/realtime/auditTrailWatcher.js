import AuditTrailModel from "../models/auditTrailModel.js";

export const AUDIT_TRAIL_POLL_INTERVAL_MS = 2000;
export const AUDIT_TRAIL_RECENT_WINDOW = 1000;

const compareIds = (left, right) => {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};

export const createAuditTrailWatcher = ({
  getPool,
  getRecentAuditIds = AuditTrailModel.getRecentAuditIds,
  getAuditIdsAfter = AuditTrailModel.getAuditIdsAfter,
  publish,
  intervalMs = AUDIT_TRAIL_POLL_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logError = console.error,
}) => {
  let knownIds = null;
  let polling = false;
  let stopped = false;
  let hasLoggedFailure = false;

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;

    try {
      const pool = await getPool();
      const recentIds = knownIds === null
        ? await getRecentAuditIds(pool, AUDIT_TRAIL_RECENT_WINDOW)
        : await getAuditIdsAfter(
            pool,
            knownIds.size > 0
              ? [...knownIds].sort(compareIds)[0]
              : "0",
          );
      const ids = recentIds.map(String);

      if (knownIds !== null) {
        const newIds = ids
          .map(String)
          .filter((id) => !knownIds.has(id))
          .sort(compareIds);

        for (const auditId of newIds) publish(auditId);
      }

      const trackedIds = new Set([...(knownIds ?? []), ...ids]);
      knownIds = new Set(
        [...trackedIds]
          .sort((left, right) => compareIds(right, left))
          .slice(0, AUDIT_TRAIL_RECENT_WINDOW),
      );
      hasLoggedFailure = false;
    } catch (error) {
      if (!hasLoggedFailure)
        logError("Audit trail realtime check failed:", error);
      hasLoggedFailure = true;
    } finally {
      polling = false;
    }
  };

  const timer = setIntervalFn(poll, intervalMs);
  timer.unref?.();
  const ready = poll();

  return {
    poll,
    ready,
    stop: () => {
      stopped = true;
      clearIntervalFn(timer);
    },
  };
};

export default { createAuditTrailWatcher };
