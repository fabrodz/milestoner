import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "./pulse.js";
import { ensureDir } from "./util/fs.js";

export const LOCK_FILE = "state.lock";

const STALE_MS = 30_000;
const POLL_MS = 20;
const WAIT_MS = 5_000;

interface LockHolder {
  pid: number;
  at: number;
}

/** A synchronous sleep, so holding the lock does not force every caller to become async. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A lock is only held across a read-modify-write of state.json, which is microseconds of work, so
 * it is stale the moment it outlives its owner. Killing processes is a first-class operation here -
 * `milestoner kill`, two interrupts, a supervisor relaunch - so a lock that could survive the process
 * that took it would be a worse failure than the race it prevents.
 */
function breakIfStale(file: string): void {
  try {
    const holder = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
    const dead = typeof holder.pid !== "number" || !isProcessAlive(holder.pid);
    if (dead || Date.now() - (holder.at ?? 0) > STALE_MS) rmSync(file, { force: true });
  } catch {
    // Unreadable, empty or half-written: it cannot be telling us anything worth waiting for.
    rmSync(file, { force: true });
  }
}

/**
 * Serialise a read-modify-write across processes.
 *
 * The engine's writes are already atomic - temp file plus rename - but an atomic write does not
 * prevent a lost update: the runner and an `unblock` issued at the same moment both load state,
 * both mutate their own copy, and whichever writes second silently discards the other. Rare when a
 * human is typing commands; routine once a web UI can post one.
 */
export function withStateLock<T>(dir: string, fn: () => T): T {
  ensureDir(dir);
  const file = join(dir, LOCK_FILE);
  const deadline = Date.now() + WAIT_MS;

  for (;;) {
    let fd: number;
    try {
      // "wx" fails if the file exists, which is what makes this an atomic test-and-set.
      fd = openSync(file, "wx");
    } catch {
      breakIfStale(file);
      if (Date.now() > deadline) {
        // A run that stops because a lock never cleared is worse than the race itself.
        rmSync(file, { force: true });
        return fn();
      }
      pause(POLL_MS);
      continue;
    }

    try {
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() } satisfies LockHolder));
      } finally {
        closeSync(fd);
      }
      return fn();
    } finally {
      rmSync(file, { force: true });
    }
  }
}
