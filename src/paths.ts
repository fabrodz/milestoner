import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const RUNPULSE_DIR = ".runpulse";

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
}

export function layoutFor(projectRoot: string): Layout {
  const dir = join(projectRoot, RUNPULSE_DIR);
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
  };
}

/** Walk up from `start` looking for a .runpulse/config.json, like git finds .git. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, RUNPULSE_DIR, "config.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveFrom(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}
