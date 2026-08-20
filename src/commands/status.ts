import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Layout } from "../paths.js";
import { isProcessAlive, newestSignal, readPulse, verdictFor } from "../pulse.js";
import { loadState, summarize } from "../state.js";
import type { Milestone, MilestonerConfig } from "../types.js";
import { color, humanDuration } from "../util/log.js";

const GLYPH: Record<Milestone["status"], string> = {
  done: color.green("done   "),
  in_progress: color.cyan("running"),
  blocked: color.red("blocked"),
  pending: color.dim("pending"),
};

function tailLines(file: string, count: number): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-count);
  } catch {
    return [];
  }
}

export interface StatusOptions {
  config: MilestonerConfig;
  layout: Layout;
  json: boolean;
}

export function status(options: StatusOptions): number {
  const { config, layout } = options;
  const state = loadState(layout.state);
  const counts = summarize(state);
  const pulse = readPulse(layout.pulse);
  const runnerAlive = pulse ? isProcessAlive(pulse.pid) : false;
  const live = newestSignal(config.projectRoot, config.liveness);
  const signalAgeMs = live ? Date.now() - live.mtime.getTime() : null;

  if (options.json) {
    // This is the supervisor's whole view of the run: everything the playbook keys on, in one call.
    const agentAlive = pulse?.agentPid != null ? isProcessAlive(pulse.agentPid) : false;
    console.log(
      JSON.stringify(
        {
          run: state.run,
          runComplete: state.runComplete,
          ...counts,
          maxAttempts: config.maxAttempts,
          milestones: state.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            status: m.status,
            attempts: m.attempts,
            evidence: m.evidence.length,
            diagnosis: m.diagnosis,
            finishedAt: m.finishedAt,
            lastAttempt: m.history.at(-1) ?? null,
          })),
          pulse: pulse
            ? {
                ...pulse,
                runnerAlive,
                agentAlive,
                sessionSeconds: pulse.sessionStartedAt ? Math.round((Date.now() - Date.parse(pulse.sessionStartedAt)) / 1000) : null,
                lastEventSeconds: Math.round((Date.now() - Date.parse(pulse.lastEventAt)) / 1000),
              }
            : null,
          liveness: live
            ? { path: live.path, mtime: live.mtime.toISOString(), ageSeconds: Math.round((signalAgeMs ?? 0) / 1000), verdict: verdictFor(signalAgeMs) }
            : null,
          livenessConfigured: config.liveness.length > 0,
          attendConfigured: config.environment.attendCommand !== null,
          recentEvents: tailLines(layout.runLog, 8),
          recentInterventions: tailLines(layout.supervisorLog, 5),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const bar = state.milestones
    .map((m) => (m.status === "done" ? "#" : m.status === "blocked" ? "!" : m.status === "in_progress" ? ">" : "."))
    .join("");
  console.log(`\n${color.bold(state.run)}  [${bar}]  ${counts.done}/${counts.total} done${counts.blocked ? color.red(`, ${counts.blocked} blocked`) : ""}`);
  console.log(color.dim(`  ${relative(process.cwd(), layout.state) || layout.state}`));
  console.log("");

  for (const m of state.milestones) {
    const attempts = m.attempts > 0 ? color.dim(` att ${m.attempts}/${config.maxAttempts}`) : "";
    const evidence = m.evidence.length > 0 ? color.dim(` ev ${m.evidence.length}`) : "";
    console.log(`  ${GLYPH[m.status]}  ${color.bold(m.id.padEnd(5))} ${m.title}${attempts}${evidence}`);
    if (m.status === "blocked" && m.diagnosis) {
      console.log(`         ${color.red("symptom")}     ${m.diagnosis.symptom}`);
      console.log(`         ${color.red("user action")} ${m.diagnosis.userAction}`);
    }
  }

  console.log(`\n${color.bold("pulse")}`);
  if (state.runComplete) {
    console.log(`  ${color.green("run complete")}`);
  } else if (!pulse) {
    console.log(`  ${color.dim("no runner")} - start one with ${color.bold("milestoner run")}`);
  } else if (!runnerAlive) {
    console.log(`  ${color.red("runner gone")} (pid ${pulse.pid} not running, last event "${pulse.lastEvent}" at ${pulse.lastEventAt})`);
    console.log(`  the run stopped without finishing; relaunch with ${color.bold("milestoner run")}`);
  } else {
    const sessionMs = pulse.sessionStartedAt ? Date.now() - Date.parse(pulse.sessionStartedAt) : null;
    const agent = pulse.agentPid != null ? `, agent pid ${pulse.agentPid}${isProcessAlive(pulse.agentPid) ? "" : color.yellow(" (gone)")}` : "";
    console.log(`  runner pid ${pulse.pid} on ${color.bold(pulse.milestoneId ?? "-")} attempt ${pulse.attempt ?? "-"}${agent}`);
    if (pulse.agent) console.log(`  agent       ${color.bold(pulse.agent)}`);
    console.log(`  last event  ${pulse.lastEvent} (${humanDuration(Date.now() - Date.parse(pulse.lastEventAt))} ago)`);
    if (sessionMs !== null) console.log(`  session     ${humanDuration(sessionMs)}`);
  }

  if (config.liveness.length === 0) {
    console.log(`  ${color.dim('liveness: not configured - set "liveness" in config.json')}`);
  } else if (!live || signalAgeMs === null) {
    console.log(`  ${color.yellow("liveness: no watched path exists yet")}`);
  } else {
    const spelt = { alive: color.green("alive"), slow: color.yellow("slow but alive"), hung: color.red("possibly hung"), unknown: "unknown" };
    console.log(`  liveness    ${spelt[verdictFor(signalAgeMs)]} - ${live.path} touched ${humanDuration(signalAgeMs)} ago`);
  }
  console.log("");

  return counts.blocked > 0 ? 2 : 0;
}
