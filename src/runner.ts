import { appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildAgentArgs } from "./config.js";
import type { Layout } from "./paths.js";
import { newestSignal, clearPulse, writePulse } from "./pulse.js";
import { archiveResult, gradeResult, readResult, type Verdict } from "./result.js";
import { classifyInfraFailure, readTranscriptTail, runSession } from "./session.js";
import { readSteering, type Steering } from "./steering.js";
import { findMilestone, loadState, nextMilestone, saveState } from "./state.js";
import type { AttemptRecord, KillMarker, Milestone, PulseflowConfig, RunState } from "./types.js";
import { ensureDir, readJsonIfExists, removeIfExists } from "./util/fs.js";
import { color, fail, humanDuration, info, ok, step, warn } from "./util/log.js";
import { iso, sleep } from "./util/time.js";

export interface RunOptions {
  config: PulseflowConfig;
  layout: Layout;
  maxAttempts?: number;
  model?: string;
  /** Stop after the first milestone attempt instead of draining the run. */
  once?: boolean;
  milestoneId?: string;
  /** Hard stop: kill the running session now, leave the milestone in_progress. */
  signal: AbortSignal;
  /** Graceful stop: let the current session finish and be graded, then launch nothing more. */
  stopSignal?: AbortSignal;
}

export type RunExit = "complete" | "blocked" | "stopped" | "infra-exhausted";

function fileStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function logEvent(layout: Layout, milestoneId: string, event: string, detail: string): void {
  ensureDir(layout.dir);
  appendFileSync(layout.runLog, `${iso()} | ${milestoneId} | ${event} | ${detail}\n`, "utf8");
}

export function buildKickoff(
  config: PulseflowConfig,
  layout: Layout,
  milestone: Milestone,
  steering: Steering | null,
): string {
  const rel = (p: string) => relative(config.projectRoot, p).replaceAll("\\", "/");
  const contract =
    `{"milestone":"${milestone.id}","status":"done"|"blocked",` +
    `"evidence":["one line per acceptance criterion, how it was verified"],` +
    `"diagnosis":{"symptom":"","tried":[""],"userAction":""},"notes":""}`;
  const kickoff = [
    `You are executing exactly one milestone of the autonomous run "${config.run}".`,
    `Working directory: ${config.projectRoot}.`,
    `First read ${rel(layout.protocol)} and follow it exactly.`,
    `Then execute the milestone defined in ${rel(join(layout.prompts, milestone.prompt))} (id ${milestone.id}).`,
    `When you are finished, write your verdict to ${rel(layout.result)} as JSON: ${contract}.`,
    `"done" requires written evidence for every acceptance criterion; "blocked" requires a diagnosis.`,
    `Do not edit state.json, the engine owns it. Do not start any other milestone.`,
  ].join(" ");

  if (!steering) return kickoff;

  // Inlined rather than referenced by path: a correction the session never opens is not steering.
  return [
    kickoff,
    "",
    `STEERING from the user, written after this run started (${rel(layout.steering)}).`,
    `It overrides the milestone prompt wherever they conflict, and it does not license`,
    `dropping an acceptance criterion. If it makes the milestone impossible, report blocked.`,
    "",
    steering.text,
  ].join("\n");
}

function applyVerdict(
  state: RunState,
  milestoneId: string,
  record: AttemptRecord,
  verdict: Verdict,
  maxAttempts: number,
): void {
  const m = findMilestone(state, milestoneId);
  if (!m) return;
  m.history.push(record);
  if (verdict.evidence.length > 0) m.evidence = verdict.evidence;
  if (verdict.diagnosis) m.diagnosis = verdict.diagnosis;

  if (verdict.outcome === "done") {
    m.status = "done";
    m.finishedAt = record.endedAt;
    return;
  }
  m.attempts += 1;
  if (verdict.outcome === "blocked") {
    m.status = "blocked";
    return;
  }
  m.status = m.attempts >= maxAttempts ? "blocked" : "pending";
}

export async function run(options: RunOptions): Promise<RunExit> {
  const { config, layout, signal } = options;
  const stopping = () => signal.aborted || options.stopSignal?.aborted === true;
  const anySignal = options.stopSignal ? AbortSignal.any([signal, options.stopSignal]) : signal;
  const maxAttempts = options.maxAttempts ?? config.maxAttempts;
  if (options.model) config.agent.model = options.model;

  ensureDir(layout.logs);
  ensureDir(layout.results);

  let infraRetries = 0;
  const startedAt = iso();

  let agentPid: number | null = null;
  let transcriptPath: string | null = null;

  const pulse = (milestone: Milestone | null, attempt: number | null, sessionStartedAt: string | null, event: string) => {
    writePulse(layout.pulse, {
      pid: process.pid,
      run: config.run,
      startedAt,
      milestoneId: milestone?.id ?? null,
      attempt,
      sessionStartedAt,
      agentPid,
      transcript: transcriptPath,
      lastEvent: event,
      lastEventAt: iso(),
    });
  };

  try {
    for (;;) {
      if (stopping()) return "stopped";
      const state = loadState(layout.state);

      if (state.runComplete) {
        step(`RUN COMPLETE (${state.run})`);
        return "complete";
      }

      const next = options.milestoneId ? findMilestone(state, options.milestoneId) : nextMilestone(state);
      if (!next) {
        if (options.milestoneId) {
          fail(`no milestone with id "${options.milestoneId}"`);
          return "stopped";
        }
        state.runComplete = true;
        saveState(layout.state, state);
        step(`RUN COMPLETE (${state.run}) - all milestones done`);
        logEvent(layout, "-", "run-complete", `${state.milestones.length} milestones`);
        return "complete";
      }

      if (next.status === "done") {
        ok(`${next.id} is already done`);
        return "complete";
      }

      if (next.status === "blocked") {
        step(`BLOCKED at ${next.id}`);
        if (next.diagnosis) {
          console.log(`  symptom:     ${next.diagnosis.symptom}`);
          if (next.diagnosis.tried.length) console.log(`  tried:       ${next.diagnosis.tried.join(" | ")}`);
          console.log(`  user action: ${color.bold(next.diagnosis.userAction)}`);
        } else {
          console.log(`  no diagnosis was written; read the last transcript in ${relative(config.projectRoot, layout.logs)}`);
        }
        console.log(`  resume with: pulseflow unblock ${next.id}`);
        pulse(next, next.attempts, null, "blocked");
        return "blocked";
      }

      if (next.attempts >= maxAttempts) {
        warn(`${next.id} exhausted ${maxAttempts} attempts - marking blocked`);
        next.status = "blocked";
        saveState(layout.state, state);
        logEvent(layout, next.id, "attempts-exhausted", `${next.attempts}/${maxAttempts}`);
        continue;
      }

      const attempt = next.attempts + 1;
      next.status = "in_progress";
      next.startedAt = next.startedAt ?? iso();
      saveState(layout.state, state);

      // A leftover drop box from an interrupted session would be graded as this attempt's result.
      removeIfExists(layout.result);
      removeIfExists(layout.kill);
      agentPid = null;

      const transcript = join(layout.logs, `${next.id}-${fileStamp()}.log`);
      transcriptPath = relative(config.projectRoot, transcript);
      const promptFile = join(layout.prompts, next.prompt);
      const steering = readSteering(layout.steering);
      const args = buildAgentArgs(config, {
        kickoff: buildKickoff(config, layout, next, steering),
        promptFile,
        milestoneId: next.id,
        projectRoot: config.projectRoot,
        pulseflowDir: layout.dir,
        model: config.agent.model ?? "",
      });

      step(`${next.id} - ${next.title}  (attempt ${attempt}/${maxAttempts})`);
      info(`prompt     ${relative(config.projectRoot, promptFile)}`);
      info(`transcript ${relative(config.projectRoot, transcript)}`);
      if (steering) info(`steering   ${color.bold(steering.headline)}`);
      const sessionStartedAt = iso();
      pulse(next, attempt, sessionStartedAt, "session-launched");
      logEvent(layout, next.id, "launch", `attempt ${attempt}/${maxAttempts}${steering ? `, steering: ${steering.headline}` : ""}`);

      const outcome = await runSession({
        command: config.agent.command,
        args,
        cwd: config.projectRoot,
        env: config.agent.env,
        transcript,
        signal,
        onSpawn: (pid) => {
          agentPid = pid ?? null;
          pulse(next, attempt, sessionStartedAt, "session-launched");
        },
        onTick: (elapsed) => {
          const live = newestSignal(config.projectRoot, config.liveness);
          const age = live ? `, newest signal ${humanDuration(Date.now() - live.mtime.getTime())} old (${live.path})` : "";
          info(color.dim(`  ${next.id} running ${humanDuration(elapsed)}${age}`));
          pulse(next, attempt, sessionStartedAt, `running ${humanDuration(elapsed)}`);
        },
      });

      // Only a hard stop skips grading: a session that ran to the end has a verdict worth keeping.
      if (signal.aborted) {
        warn("killed - leaving the milestone in_progress");
        logEvent(layout, next.id, "interrupted", `killed after ${humanDuration(outcome.ms)}`);
        return "stopped";
      }

      const seconds = outcome.ms / 1000;
      info(`session ended (exit ${outcome.exitCode ?? outcome.signal}, ${humanDuration(outcome.ms)}, ${outcome.bytes} B transcript)`);

      const rawResult = readResult(layout.result);

      // A supervisor kill is an intervention against work that was going nowhere: it consumes the
      // attempt, even though the session looks like an infrastructure death from the outside.
      const killed = readJsonIfExists<KillMarker>(layout.kill);
      removeIfExists(layout.kill);
      if (killed && killed.milestoneId === next.id) {
        warn(`session was killed by a supervisor: ${killed.reason}`);
        logEvent(layout, next.id, "killed", killed.reason);
      }

      const infra = killed
        ? null
        : classifyInfraFailure(
            { seconds, bytes: outcome.bytes, text: readTranscriptTail(transcript), wroteResult: rawResult !== null },
            config.infra,
          );

      if (infra) {
        infraRetries += 1;

        // Record and hand the milestone back as pending first: whatever happens next, a relaunch
        // must find a clean entry point rather than a milestone stuck in_progress.
        const back = loadState(layout.state);
        const m = findMilestone(back, next.id);
        if (m) {
          m.status = "pending";
          m.history.push({
            attempt,
            startedAt: sessionStartedAt,
            endedAt: iso(),
            seconds: Math.round(seconds),
            exitCode: outcome.exitCode,
            transcript: relative(config.projectRoot, transcript),
            outcome: "infra-failure",
            detail: `${infra.reason}: ${infra.detail}`,
            steering: steering?.headline,
          });
          saveState(layout.state, back);
        }
        logEvent(layout, next.id, `infra:${infra.reason}`, `${infra.detail}; wait ${infra.waitSeconds}s`);

        if (infraRetries > config.infra.maxRetries) {
          fail(`too many infrastructure failures (${infraRetries}) - giving up`);
          logEvent(layout, next.id, "infra-exhausted", `${infraRetries} consecutive`);
          return "infra-exhausted";
        }
        warn(
          `${infra.reason}: ${infra.detail} - waiting ${humanDuration(infra.waitSeconds * 1000)}, ` +
            `attempt NOT consumed (${infraRetries}/${config.infra.maxRetries})`,
        );
        pulse(next, attempt, null, `waiting out ${infra.reason}`);
        await sleep(infra.waitSeconds, anySignal);
        continue;
      }
      infraRetries = 0;

      const verdict = gradeResult(rawResult, next.id);
      for (const w of verdict.warnings) warn(`  ${w}`);
      if (rawResult) archiveResult(layout.result, layout.results, next.id, attempt);

      const record: AttemptRecord = {
        attempt,
        startedAt: sessionStartedAt,
        endedAt: iso(),
        seconds: Math.round(seconds),
        exitCode: outcome.exitCode,
        transcript: relative(config.projectRoot, transcript),
        outcome: verdict.outcome,
        detail: verdict.warnings.join("; ") || undefined,
        steering: steering?.headline,
      };

      const after = loadState(layout.state);
      applyVerdict(after, next.id, record, verdict, maxAttempts);
      saveState(layout.state, after);
      logEvent(
        layout,
        next.id,
        verdict.outcome,
        `attempt ${attempt}, ${Math.round(seconds)}s${record.detail ? `, ${record.detail}` : ""}`,
      );

      if (verdict.outcome === "done") {
        ok(`${next.id} DONE - ${verdict.evidence.length} evidence line(s)`);
      } else if (verdict.outcome === "blocked") {
        warn(`${next.id} reported blocked`);
      } else {
        warn(`${next.id} incomplete - retrying`);
      }

      if (options.once) return "stopped";
      if (stopping()) {
        warn("stopping as requested - the run resumes with `pulseflow run`");
        return "stopped";
      }
      if (verdict.outcome !== "done") await sleep(config.retryDelaySeconds, anySignal);
    }
  } finally {
    clearPulse(layout.pulse);
  }
}
