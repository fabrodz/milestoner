import { spawnSync } from "node:child_process";
import type { Layout } from "../paths.js";
import { isProcessAlive, readPulse } from "../pulse.js";
import { appendSupervisorLog } from "../supervisorLog.js";
import type { KillMarker } from "../types.js";
import { writeJsonAtomic } from "../util/fs.js";
import { fail, ok, warn } from "../util/log.js";
import { iso } from "../util/time.js";

export interface KillOptions {
  layout: Layout;
  reason: string;
  rule: string;
}

/**
 * Kill the agent session, never the runner. The runner sees the session end, grades it as
 * incomplete, consumes the attempt and relaunches - which is the whole point of the intervention.
 */
export function kill(options: KillOptions): number {
  const pulse = readPulse(options.layout.pulse);
  if (!pulse) {
    fail("no pulse.json - no run is in progress");
    return 1;
  }
  if (!isProcessAlive(pulse.pid)) {
    fail(`the runner (pid ${pulse.pid}) is not running - nothing to kill; relaunch with \`milestoner run\``);
    return 1;
  }
  if (pulse.agentPid === null) {
    warn(`no agent session right now (last event: ${pulse.lastEvent}) - nothing to kill`);
    return 1;
  }
  if (!isProcessAlive(pulse.agentPid)) {
    warn(`the agent session (pid ${pulse.agentPid}) already ended - nothing to kill`);
    return 1;
  }

  const marker: KillMarker = {
    milestoneId: pulse.milestoneId ?? "-",
    agentPid: pulse.agentPid,
    at: iso(),
    reason: options.reason,
  };
  // Written before the kill so the runner cannot grade the death as an infrastructure failure.
  writeJsonAtomic(options.layout.kill, marker);

  const killed =
    process.platform === "win32"
      ? spawnSync("taskkill", ["/PID", String(pulse.agentPid), "/T", "/F"], { encoding: "utf8" }).status === 0
      : safeKill(pulse.agentPid);

  const result = killed ? "killed" : "kill failed";
  appendSupervisorLog(options.layout, options.rule, `kill agent pid ${pulse.agentPid} on ${marker.milestoneId}: ${options.reason}`, result);

  if (!killed) {
    fail(`could not kill pid ${pulse.agentPid}`);
    return 1;
  }
  ok(`killed the agent session on ${marker.milestoneId} (pid ${pulse.agentPid}) - the runner will consume the attempt and retry`);
  return 0;
}

function safeKill(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
