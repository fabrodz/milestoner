import { dirname } from "node:path";
import { withStateLock } from "./lock.js";
import { layoutFor, samePath } from "./paths.js";
import { isProcessAlive, readPulse, verdictFor, type LivenessVerdict } from "./pulse.js";
import { loadState, nextMilestone, summarize } from "./state.js";
import type { Pulse, RunState } from "./types.js";
import { readJsonIfExists, writeJsonAtomic } from "./util/fs.js";
import { iso } from "./util/time.js";

/**
 * How long a run whose runner is gone stays in the listing. Registering only live runners would be
 * simpler, but a run that died at 2am is exactly the one a person wants to be told about, and an
 * entry that deletes itself the moment its process ends can never say so. See D-025.
 */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RunEntry {
  pid: number;
  run: string;
  projectRoot: string;
  /** When this runner started, which is what tells a relaunch from the entry it replaced. */
  startedAt: string;
  /** Refreshed on every pulse write. A live runner's entry is never more than a tick old. */
  lastSeen: string;
}

export type RunHealth = LivenessVerdict | "gone" | "complete";

export interface RunSummary {
  run: string;
  projectRoot: string;
  pid: number;
  startedAt: string;
  lastSeen: string;
  runnerAlive: boolean;
  health: RunHealth;
  milestoneId: string | null;
  attempt: number | null;
  done: number;
  total: number;
  blocked: number;
  runComplete: boolean;
  lastEventSeconds: number | null;
}

export interface PrunedRun {
  projectRoot: string;
  run: string;
  pid: number;
  reason: "project-gone" | "expired";
}

export interface RunListing {
  file: string;
  runs: RunSummary[];
  pruned: PrunedRun[];
}

interface RegistryFile {
  runs: RunEntry[];
}

function isEntry(value: unknown): value is RunEntry {
  const e = value as Partial<RunEntry> | null;
  return typeof e?.pid === "number" && typeof e.run === "string" && typeof e.projectRoot === "string";
}

function read(file: string): RunEntry[] {
  const raw = readJsonIfExists<RegistryFile>(file);
  if (!raw || !Array.isArray(raw.runs)) return [];
  return raw.runs.filter(isEntry).map((e) => ({ ...e, startedAt: e.startedAt ?? "", lastSeen: e.lastSeen ?? "" }));
}

/**
 * Every write is best-effort. The registry is a convenience across projects, never a precondition
 * for one: a home directory that is read-only, or on a network share that is not mounted, must not
 * stop a run from starting. A failure here is swallowed and the run carries on without an entry.
 *
 * Serialised with the lock from D-022, which is the same lost-update shape: several runners on one
 * machine start, tick and exit against one file.
 */
function edit(file: string, mutate: (runs: RunEntry[]) => RunEntry[]): boolean {
  try {
    withStateLock(dirname(file), () => writeJsonAtomic(file, { runs: mutate(read(file)) } satisfies RegistryFile));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record this runner. Idempotent by project directory - one run per project is already the rule, so
 * a relaunch replaces the entry it inherited rather than listing the directory twice.
 */
export function registerRun(file: string, entry: Omit<RunEntry, "lastSeen">, now: string = iso()): boolean {
  return edit(file, (runs) => [...runs.filter((r) => !samePath(r.projectRoot, entry.projectRoot)), { ...entry, lastSeen: now }]);
}

export function deregisterRun(file: string, projectRoot: string, pid: number): boolean {
  return edit(file, (runs) => runs.filter((r) => !(r.pid === pid && samePath(r.projectRoot, projectRoot))));
}

/**
 * Is the process behind this entry still the runner it claims to be?
 *
 * Pids are reused, so a live pid on its own proves nothing. The corroborating witness is the
 * project's own `pulse.json`: the runner writes it on start and clears it in the same `finally`
 * that deregisters, so a pid that is alive but whose project has no pulse - or whose pulse belongs
 * to a different pid or a different run - is some unrelated process wearing a recycled number.
 */
function runnerIsAlive(entry: RunEntry, pulse: Pulse | null): boolean {
  if (!pulse || pulse.pid !== entry.pid || pulse.run !== entry.run) return false;
  return isProcessAlive(entry.pid);
}

/**
 * The cheap form of the question the panel daemon asks on every poll: is anything still moving?
 * No state.json loads and no pruning - just entries, pulses and pids.
 */
export function hasLiveRunner(file: string): boolean {
  return read(file).some((entry) => runnerIsAlive(entry, readPulse(layoutFor(entry.projectRoot).pulse)));
}

export interface SeenRun {
  run: string;
  projectRoot: string;
  pid: number;
  startedAt: string;
  lastSeen: string;
}

/**
 * A run the machine panel watched, now deregistered. A clean exit removes the registry entry
 * (D-025), which is right for the file and wrong for an open tab: the run would vanish at the
 * exact moment its outcome is the thing worth showing. The panel remembers what it served and
 * summarises it from the project's own state for as long as the panel lives.
 */
export function summariseUnregistered(seen: SeenRun, whenUnfinished: RunHealth = "gone"): RunSummary | null {
  let state: RunState;
  try {
    state = loadState(layoutFor(seen.projectRoot).state);
  } catch {
    return null;
  }
  return {
    run: state.run || seen.run,
    projectRoot: seen.projectRoot,
    pid: seen.pid,
    startedAt: seen.startedAt,
    lastSeen: seen.lastSeen,
    runnerAlive: false,
    health: state.runComplete ? "complete" : whenUnfinished,
    milestoneId: nextMilestone(state)?.id ?? null,
    attempt: null,
    ...summarize(state),
    runComplete: state.runComplete,
    lastEventSeconds: null,
  };
}

/**
 * A project known only because the CLI worked in it once: no registry entry, no runner this panel
 * ever watched, nothing but a path and whatever `state.json` says. Unfinished reads `unknown` rather
 * than `gone`, because nothing died here - a machine whose every idle project claimed a dead runner
 * would report an emergency on a quiet morning.
 */
export function summariseKnownProject(root: string, lastSeen = ""): RunSummary | null {
  return summariseUnregistered({ run: "", projectRoot: root, pid: 0, startedAt: "", lastSeen }, "unknown");
}

function summarise(entry: RunEntry, state: RunState, pulse: Pulse | null, alive: boolean, now: number): RunSummary {
  const counts = summarize(state);
  const lastEventMs = alive && pulse ? now - Date.parse(pulse.lastEventAt) : null;
  return {
    run: state.run || entry.run,
    projectRoot: entry.projectRoot,
    pid: entry.pid,
    startedAt: entry.startedAt,
    lastSeen: entry.lastSeen,
    runnerAlive: alive,
    health: state.runComplete ? "complete" : alive ? verdictFor(lastEventMs) : "gone",
    milestoneId: (alive ? pulse?.milestoneId : null) ?? nextMilestone(state)?.id ?? null,
    attempt: alive ? (pulse?.attempt ?? null) : null,
    ...counts,
    runComplete: state.runComplete,
    lastEventSeconds: lastEventMs === null || !Number.isFinite(lastEventMs) ? null : Math.round(lastEventMs / 1000),
  };
}

/**
 * Every registered run, enriched from each project's own `state.json` and `pulse.json`, with the
 * entries that no longer describe anything dropped from the file as a side effect.
 *
 * The liveness verdict comes from the age of the pulse's last event rather than from a walk of the
 * watched paths: `runs` reads every project on the machine, and a recursive mtime scan per project
 * would make the cheap question expensive.
 */
export function listRuns(file: string, now: number = Date.now()): RunListing {
  const runs: RunSummary[] = [];
  const pruned: PrunedRun[] = [];

  for (const entry of read(file)) {
    const layout = layoutFor(entry.projectRoot);
    let state: RunState;
    try {
      state = loadState(layout.state);
    } catch {
      // Deleted, renamed, or on a drive that is not mounted. One unreachable project must not cost
      // the listing every other run on the machine.
      pruned.push({ projectRoot: entry.projectRoot, run: entry.run, pid: entry.pid, reason: "project-gone" });
      continue;
    }

    const pulse = readPulse(layout.pulse);
    const alive = runnerIsAlive(entry, pulse);
    const seen = Date.parse(entry.lastSeen);
    if (!alive && Number.isFinite(seen) && now - seen > RETENTION_MS) {
      pruned.push({ projectRoot: entry.projectRoot, run: entry.run, pid: entry.pid, reason: "expired" });
      continue;
    }

    runs.push(summarise(entry, state, pulse, alive, now));
  }

  if (pruned.length > 0) {
    // Re-filtered under the lock rather than written back wholesale: a runner may have registered
    // between the read above and this write, and it would be lost.
    edit(file, (current) => current.filter((r) => !pruned.some((p) => p.pid === r.pid && samePath(p.projectRoot, r.projectRoot))));
  }

  return { file, runs, pruned };
}
