// A best-effort server-side kick, not a durable worker. The SQL outbox remains
// authoritative if the platform terminates an invocation or a provider is down.
export function createBackgroundRunner({ waitUntil, getDeadline, clock = Date.now } = {}) {
  return (task, fallbackDeadline = Infinity) => {
    const deadline = Math.min(getDeadline?.()?.getTime() ?? Infinity, fallbackDeadline);
    // One sync may need a 30s submit and a 30s receipt call. Avoid starting a
    // write near the invocation deadline, when its response could be lost.
    if (deadline - clock() < 75_000) return;
    const pending = Promise.resolve().then(task).catch(() => {
      console.error('Automatic memory background sync was unavailable. Check the existing queue and receipts.');
    });
    waitUntil?.(pending);
    return pending;
  };
}
