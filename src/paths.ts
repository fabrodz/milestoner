import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const PULSEFLOW_DIR = ".pulseflow";

/** The directory name this project used before the rename; still found, never written. */
export const LEGACY_DIR = ".runpulse";

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
  /** Written by `pulseflow kill`, consumed by the runner on the next session end. */
  kill: string;
  /** The user's mid-flight channel into a running run. */
  steering: string;
  report: string;
}

export function layoutFor(projectRoot: string): Layout {
  const dir = join(projectRoot, PULSEFLOW_DIR);
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

/** Walk up from `start` looking for a .pulseflow/config.json, like git finds .git. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  return findUpwards(start, PULSEFLOW_DIR);
}

/**
 * A run set up before the rename. Found only to tell the user how to migrate: the layout is
 * derived from the directory name, so renaming the directory is the whole migration.
 */
export function findLegacyRoot(start: string = process.cwd()): string | null {
  return findUpwards(start, LEGACY_DIR);
}

export function resolveFrom(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}
