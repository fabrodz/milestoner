import { closeSync, linkSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "./pulse.js";
import { ensureDir } from "./util/fs.js";

export const LOCK_FILE = "state.lock";

const STALE_MS = 30_000;
const POLL_MS = 20;
const WAIT_MS = 60_000;
const UNREADABLE_GRACE_MS = 3_000;

interface LockHolder {
  pid: number;
  at: number;
  seq: number;
}

let seq = 0;
let linkUnsupported = false;

/** A synchronous sleep, so holding the lock does not force every caller to become async. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A lock is only held across a read-modify-write of state.json, which is microseconds of work, so
 * it is stale the moment it outlives its owner. Killing processes is a first-class operation here -
 * `milestoner kill`, two interrupts, a supervisor relaunch - so a lock that could survive the process
 * that took it would be a worse failure than the race it prevents.
 *
 * The one thing that must never be broken on sight is a lock that cannot be read: under the `wx`
 * fallback in tryAcquire, a lock exists empty for the instant between creation and the holder's
 * write, so an empty file is the signature of a lock acquired just now - the one that most needs
 * respecting. The grace is keyed on the file's own mtime because the contender is a different
 * process on each attempt; the filesystem is the only party that saw the file appear. Three seconds
 * rather than a few hundred milliseconds because FAT-family filesystems round mtime to whole
 * seconds, and FAT is exactly where the `wx` fallback runs.
 */
export function breakIfStale(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return; // gone already, or unreadable at the filesystem level: nothing to judge
  }
  try {
    const holder = JSON.parse(raw) as LockHolder;
    const dead = typeof holder.pid !== "number" || !isProcessAlive(holder.pid);
    if (dead || Date.now() - (holder.at ?? 0) > STALE_MS) rmSync(file, { force: true });
  } catch {
    try {
      if (Date.now() - statSync(file).mtimeMs > UNREADABLE_GRACE_MS) rmSync(file, { force: true });
    } catch {
      // resolved by someone else between the read and the stat
    }
  }
}

/**
 * Take the lock so that it carries its holder from the first instant it exists. The payload goes
 * into a temp file first and `linkSync` publishes it: the link either lands whole or fails with
 * EEXIST, so no contender can ever observe an empty lock on this path. Any other link error means
 * the filesystem cannot do hard links, and this process drops to `wx`-then-write for good - the
 * empty-file window that reopens is what the grace in breakIfStale covers.
 *
 * Returns the payload written, or null when the lock is held. The payload is built per attempt so
 * `at` is the acquisition time, not the time the caller started waiting.
 */
function tryAcquire(dir: string, file: string): string | null {
  seq += 1;
  const payload = JSON.stringify({ pid: process.pid, at: Date.now(), seq } satisfies LockHolder);

  if (!linkUnsupported) {
    // One temp name per process: withStateLock is synchronous, so a process never races itself,
    // and a crashed holder leaves at most one stray file that its next incarnation overwrites.
    const tmp = join(dir, `${LOCK_FILE}.${process.pid}`);
    try {
      writeFileSync(tmp, payload);
      linkSync(tmp, file);
      rmSync(tmp, { force: true });
      return payload;
    } catch (err) {
      rmSync(tmp, { force: true });
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
      linkUnsupported = true;
    }
  }

  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch {
    return null;
  }
  try {
    writeFileSync(fd, payload);
  } finally {
    closeSync(fd);
  }
  return payload;
}

/**
 * Only the payload's author may remove the lock. Without the check, a holder that was broken as
 * stale would, on finishing, delete the lock the breaker has since taken - handing the critical
 * section to a third process. Read-compare-delete is not atomic, but reaching the residual window
 * requires this holder to have been wedged past STALE_MS first.
 */
function release(file: string, payload: string): void {
  try {
    if (readFileSync(file, "utf8") === payload) rmSync(file, { force: true });
  } catch {
    // gone or unreadable: broken while we were wedged, and no longer ours to remove
  }
}

/**
 * Serialise a read-modify-write across processes.
 *
 * The engine's writes are already atomic - temp file plus rename - but an atomic write does not
 * prevent a lost update: the runner and an `unblock` issued at the same moment both load state,
 * both mutate their own copy, and whichever writes second silently discards the other. Rare when a
 * human is typing commands; routine once a web UI can post one.
 *
 * Liveness comes from the stale rules, not from stealing: a dead holder is broken at once, a
 * wedged live one at STALE_MS, an unreadable lock at its grace. The deadline below is therefore
 * unreachable through any failure those rules can name; if a minute passes with none of them
 * applying, proceeding unlocked beats wedging the run. The lock file is left in place on that path,
 * because deleting it is what would let a third process in.
 */
export function withStateLock<T>(dir: string, fn: () => T): T {
  ensureDir(dir);
  const file = join(dir, LOCK_FILE);
  const deadline = Date.now() + WAIT_MS;

  for (;;) {
    const payload = tryAcquire(dir, file);
    if (payload !== null) {
      try {
        return fn();
      } finally {
        release(file, payload);
      }
    }
    breakIfStale(file);
    if (Date.now() > deadline) return fn();
    pause(POLL_MS);
  }
}
