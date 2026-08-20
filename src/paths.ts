import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MILESTONER_DIR = ".milestoner";

export const REGISTRY_FILE = "runs.json";

/**
 * Directory names this project has used before, newest first. Found only so the CLI can explain the
 * migration; never written. Every rename appends one rather than replacing it: a run parked on an
 * old name for two renames still deserves the message.
 */
export const LEGACY_DIRS = [".dogwatch", ".pulseflow", ".runpulse"] as const;

export interface Layout {
  projectRoot: string;
  dir: string;
  config: string;
  state: string;
  protocol: string;
  prompts: string;
  logs: string;
  results: string;
  /** Drop box the agent session writes; the engine owns state.json. */
  result: string;
  pulse: string;
  runLog: string;
  supervisorLog: string;
  /** Written by `milestoner kill`, consumed by the runner on the next session end. */
  kill: string;
  /** The user's mid-flight channel into a running run. */
  steering: string;
  report: string;
}

export function layoutFor(projectRoot: string): Layout {
  const dir = join(projectRoot, MILESTONER_DIR);
  return {
    projectRoot,
    dir,
    config: join(dir, "config.json"),
    state: join(dir, "state.json"),
    protocol: join(dir, "protocol.md"),
    prompts: join(dir, "prompts"),
    logs: join(dir, "logs"),
    results: join(dir, "results"),
    result: join(dir, "result.json"),
    pulse: join(dir, "pulse.json"),
    runLog: join(dir, "run-log.md"),
    supervisorLog: join(dir, "supervisor-log.md"),
    kill: join(dir, "kill.json"),
    steering: join(dir, "STEERING.md"),
    report: join(dir, "report.html"),
  };
}

function findUpwards(start: string, dir: string): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, dir, "config.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Walk up from `start` looking for a .milestoner/config.json, like git finds .git. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  return findUpwards(start, MILESTONER_DIR);
}

export interface LegacyRun {
  root: string;
  dir: string;
}

/**
 * A run set up under an older name. Found only to tell the user how to migrate: the layout is
 * derived from the directory name, so renaming the directory is the whole migration.
 */
export function findLegacyRoot(start: string = process.cwd()): LegacyRun | null {
  for (const dir of LEGACY_DIRS) {
    const root = findUpwards(start, dir);
    if (root) return { root, dir };
  }
  return null;
}

export function resolveFrom(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}

/**
 * The machine-level directory, beside the per-project layout: `~/.milestoner`, or whatever
 * `MILESTONER_HOME` points at. One path on every platform, XDG included, per D-025 - resolved on
 * every call so a test or a user can move it without reloading the module.
 */
export function machineDir(): string {
  const override = process.env.MILESTONER_HOME;
  return override && override.trim() !== "" ? resolve(override) : join(homedir(), MILESTONER_DIR);
}

/** The registry of runs on this machine. */
export function registryPath(): string {
  return join(machineDir(), REGISTRY_FILE);
}

/** Compare two project roots as the filesystem would: Windows and macOS do not mind the case. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === "linux" ? resolve(p) : resolve(p).toLowerCase());
  return norm(a) === norm(b);
}
