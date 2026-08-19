export function iso(d: Date = new Date()): string {
  return d.toISOString();
}

export function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, seconds * 1000);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Claude Code prints "You've hit your session limit · resets 3:00pm" when it refuses to start.
 * Waiting until that exact time beats a fixed sleep: no early relaunch, no hour of idle.
 * Returns seconds to wait, or null when no reset time is present.
 */
export function secondsUntilReset(text: string, now: Date = new Date()): number | null {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  const seconds = Math.ceil((target.getTime() - now.getTime()) / 1000);
  return seconds > 12 * 3600 ? null : seconds + 30;
}
