import { appendFileSync, existsSync } from "node:fs";
import type { Layout } from "./paths.js";
import { ensureDir } from "./util/fs.js";
import { iso } from "./util/time.js";

export const SUPERVISOR_LOG_HEADER = "# Supervisor log\n\n`<time> | <rule> | <what> | <result>`\n\n";

/** Every intervention leaves one line. A supervisor that acts without a trace cannot be audited. */
export function appendSupervisorLog(layout: Layout, rule: string, what: string, result: string): void {
  ensureDir(layout.dir);
  if (!existsSync(layout.supervisorLog)) {
    appendFileSync(layout.supervisorLog, SUPERVISOR_LOG_HEADER, "utf8");
  }
  appendFileSync(layout.supervisorLog, `${iso()} | ${rule} | ${what} | ${result}\n`, "utf8");
}
