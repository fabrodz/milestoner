import { spawnSync } from "node:child_process";
import { renderTemplate } from "../config.js";
import type { Layout } from "../paths.js";
import { appendSupervisorLog } from "../supervisorLog.js";
import type { RunpulseConfig } from "../types.js";
import { fail, info, ok } from "../util/log.js";

export interface AttendOptions {
  config: RunpulseConfig;
  layout: Layout;
  seconds?: number;
  rule: string;
}

/**
 * Run the environment adapter: the one intervention a supervisor may make against a host-bound
 * environment (refocus a window, dismiss a native modal, restart a tool server). It never touches
 * the project - the executor session owns that.
 */
export function attend(options: AttendOptions): number {
  const command = options.config.environment.attendCommand;
  if (!command) {
    fail('no environment adapter configured - set "environment.attendCommand" in .runpulse/config.json');
    info('  example: "powershell -ExecutionPolicy Bypass -File .runpulse/adapters/unity-attend.ps1 -Seconds {{seconds}}"');
    return 1;
  }

  const seconds = options.seconds ?? options.config.environment.attendSeconds;
  const line = renderTemplate(command, { seconds: String(seconds) });
  info(`attend: ${line}`);

  // A user-supplied command line, so the shell is the right interpreter here.
  const result = spawnSync(line, {
    cwd: options.config.projectRoot,
    shell: true,
    encoding: "utf8",
    timeout: (seconds + 60) * 1000,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) console.log(output.split("\n").slice(-10).join("\n"));

  const status = result.status === 0 ? `ok` : `exit ${result.status ?? result.signal}`;
  appendSupervisorLog(options.layout, options.rule, `attend ${seconds}s`, `${status}${output ? `: ${output.split("\n").slice(-1)[0]}` : ""}`);

  if (result.status === 0) {
    ok(`environment adapter finished (${seconds}s)`);
    return 0;
  }
  fail(`environment adapter ${status}`);
  return 1;
}
