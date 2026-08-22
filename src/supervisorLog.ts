import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Layout } from "./paths.js";
import { ensureDir } from "./util/fs.js";
import { iso } from "./util/time.js";

export const SUPERVISOR_LOG_HEADER = "# Supervisor log\n\n`<time> | <rule> | <what> | <result>`\n\n";

/**
 * The interventions in the log, newest last, without its own header. The title and the
 * backtick-quoted format line are scaffold `init` writes before anything has happened, and a reader
 * that tails the file raw shows them as two interventions on a run that never needed one.
 */
export function readInterventions(file: string, count: number): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("`"))
      .slice(-count);
  } catch {
    return [];
  }
}

/** Every intervention leaves one line. A supervisor that acts without a trace cannot be audited. */
export function appendSupervisorLog(layout: Layout, rule: string, what: string, result: string): void {
  ensureDir(layout.dir);
  if (!existsSync(layout.supervisorLog)) {
    appendFileSync(layout.supervisorLog, SUPERVISOR_LOG_HEADER, "utf8");
  }
  appendFileSync(layout.supervisorLog, `${iso()} | ${rule} | ${what} | ${result}\n`, "utf8");
}
