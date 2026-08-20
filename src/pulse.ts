import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readJsonIfExists, removeIfExists, writeJsonAtomic } from "./util/fs.js";
import { resolveFrom } from "./paths.js";
import type { Pulse } from "./types.js";

const SKIP = new Set(["node_modules", ".git", ".milestoner", "dist", "Library", "Temp", "obj", "bin"]);

export interface LivenessSignal {
  path: string;
  mtime: Date;
}

function newestUnder(root: string, depth: number): LivenessSignal | null {
  let best: LivenessSignal | null = null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth <= 0) continue;
      const nested = newestUnder(full, depth - 1);
      if (nested && (!best || nested.mtime > best.mtime)) best = nested;
    } else {
      try {
        const m = statSync(full).mtime;
        if (!best || m > best.mtime) best = { path: full, mtime: m };
      } catch {
        /* vanished mid-scan */
      }
    }
  }
  return best;
}

/**
 * Liveness comes from side signals - tool logs, test results, source mtimes - never from the
 * transcript: a headless session flushes it only at exit.
 */
export function newestSignal(projectRoot: string, watch: string[], depth = 6): LivenessSignal | null {
  let best: LivenessSignal | null = null;
  for (const entry of watch) {
    const full = resolveFrom(projectRoot, entry);
    let candidate: LivenessSignal | null = null;
    try {
      candidate = statSync(full).isDirectory() ? newestUnder(full, depth) : { path: full, mtime: statSync(full).mtime };
    } catch {
      continue;
    }
    if (candidate && (!best || candidate.mtime > best.mtime)) best = candidate;
  }
  if (best) best = { ...best, path: relative(projectRoot, best.path) || best.path };
  return best;
}

export function writePulse(pulsePath: string, pulse: Pulse): void {
  writeJsonAtomic(pulsePath, pulse);
}

export function readPulse(pulsePath: string): Pulse | null {
  return readJsonIfExists<Pulse>(pulsePath);
}

export function clearPulse(pulsePath: string): void {
  removeIfExists(pulsePath);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
