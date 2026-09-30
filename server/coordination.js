import { randomUUID } from "node:crypto";

// All state lives in the database, not in a single serverless instance.
export function createCoordination(store, { clock = Date.now } = {}) {
  return {
    async consume(key, limit, windowMs) {
      const time = clock();
      const row = await store.get(`INSERT INTO rate_limits (key,count,until) VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET
          count=CASE WHEN rate_limits.until<=? THEN 1 ELSE rate_limits.count+1 END,
          until=CASE WHEN rate_limits.until<=? THEN excluded.until ELSE rate_limits.until END
        RETURNING count,until`, key, time + windowMs, time, time);
      return { allowed: Number(row.count) <= limit, retryAfter: Math.max(1, Math.ceil((Number(row.until) - time) / 1000)) };
    },
    async acquire(key, ttlMs = 120_000) {
      const time = clock(), token = randomUUID();
      const row = await store.get(`INSERT INTO operation_locks (key,token,expires_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
        WHERE operation_locks.expires_at<=? RETURNING token`, key, token, time + ttlMs, time);
      return row?.token === token ? { key, token } : null;
    },
    async assert(lease, tx = store) {
      // UPDATE locks the row until this transaction finishes (a fenced commit).
      const result = await tx.run("UPDATE operation_locks SET expires_at=expires_at WHERE key=? AND token=? AND expires_at>?", lease.key, lease.token, clock());
      if (!Number(result.changes)) throw Object.assign(new Error("This operation expired. Refresh before trying again."), { status: 409, code: "OPERATION_EXPIRED" });
    },
    async release(lease) {
      if (lease) await store.run("DELETE FROM operation_locks WHERE key=? AND token=?", lease.key, lease.token);
    },
    async cleanup() {
      // Grace period prevents cleanup racing an active operation at the boundary.
      await store.run("DELETE FROM rate_limits WHERE until<?", clock() - 3_600_000);
      await store.run("DELETE FROM operation_locks WHERE expires_at<?", clock() - 3_600_000);
    },
  };
}
