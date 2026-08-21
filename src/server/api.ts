import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { attend } from "../commands/attend.js";
import { kill } from "../commands/kill.js";
import { collectLintInput, gatingFindings, lintTotals } from "../commands/lint.js";
import { steer } from "../commands/steer.js";
import { unblock } from "../commands/unblock.js";
import { lintRun, type LintFinding } from "../lint.js";
import type { Layout } from "../paths.js";
import { isProcessAlive, newestSignal, readPulse } from "../pulse.js";
import { buildReport } from "../report.js";
import { loadState, summarize } from "../state.js";
import type { MilestonerConfig } from "../types.js";

export interface ApiContext {
  config: MilestonerConfig;
  layout: Layout;
  /** Absolute path to this CLI, so `run` is relaunched exactly as the user installed it. */
  cliPath: string;
}

function tail(file: string, count: number): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-count);
  } catch {
    return [];
  }
}

/** The whole view of a run in one object: what `status --json` gives, plus the rev to poll on. */
export function snapshot(ctx: ApiContext) {
  const state = loadState(ctx.layout.state);
  const pulse = readPulse(ctx.layout.pulse);
  const live = newestSignal(ctx.config.projectRoot, ctx.config.liveness);
  const runnerAlive = pulse ? isProcessAlive(pulse.pid) : false;

  return {
    run: state.run,
    rev: state.rev,
    runComplete: state.runComplete,
    ...summarize(state),
    maxAttempts: ctx.config.maxAttempts,
    milestones: state.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      attempts: m.attempts,
      evidence: m.evidence,
      diagnosis: m.diagnosis,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      history: m.history,
    })),
    pulse: pulse
      ? {
          ...pulse,
          runnerAlive,
          agentAlive: pulse.agentPid != null ? isProcessAlive(pulse.agentPid) : false,
          sessionSeconds: pulse.sessionStartedAt ? Math.round((Date.now() - Date.parse(pulse.sessionStartedAt)) / 1000) : null,
        }
      : null,
    liveness: live ? { path: live.path, ageSeconds: Math.round((Date.now() - live.mtime.getTime()) / 1000) } : null,
    livenessConfigured: ctx.config.liveness.length > 0,
    attendConfigured: ctx.config.environment.attendCommand !== null,
    steering: existsSync(ctx.layout.steering) ? readFileSync(ctx.layout.steering, "utf8") : null,
    runLog: tail(ctx.layout.runLog, 40),
    supervisorLog: tail(ctx.layout.supervisorLog, 20),
    transcripts: state.milestones.flatMap((m) => m.history.map((h) => h.transcript)).slice(-25),
  };
}

export function reportHtml(ctx: ApiContext): string {
  const state = loadState(ctx.layout.state);
  const lines = (file: string, max: number) =>
    tail(file, max).filter((l) => !l.startsWith("#") && !l.startsWith("`"));
  return buildReport({
    state,
    maxAttempts: ctx.config.maxAttempts,
    runLog: lines(ctx.layout.runLog, 200),
    supervisorLog: lines(ctx.layout.supervisorLog, 100),
    generatedAt: new Date(),
  });
}

/**
 * Transcripts are served by name only, resolved inside the logs directory and checked afterwards.
 * The name arrives over HTTP, so treating it as a path is how a caller reads /etc/passwd.
 */
export function transcript(ctx: ApiContext, name: string): string | null {
  const file = resolve(ctx.layout.logs, basename(name));
  if (relative(ctx.layout.logs, file).startsWith("..") || !existsSync(file)) return null;
  return readFileSync(file, "utf8").slice(-200_000);
}

/** Exactly what `milestoner lint --json` prints: one shape, whichever front end asked. */
export function lintFindings(ctx: ApiContext): { run: string; errors: number; warnings: number; findings: LintFinding[] } {
  const state = loadState(ctx.layout.state);
  const findings = lintRun(collectLintInput(ctx.config, ctx.layout, state));
  const { errors, warnings } = lintTotals(findings);
  return { run: state.run, errors, warnings, findings };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** True when a start was refused by the lint gate, so the panel can offer the deliberate bypass. */
  lintRefused?: boolean;
}

const outcome = (code: number, done: string, failed: string): ActionResult =>
  code === 0 ? { ok: true, message: done } : { ok: false, message: failed };

export function doSteer(ctx: ApiContext, text: string | undefined, append: boolean, clear: boolean): ActionResult {
  const code = steer({ layout: ctx.layout, text, append, clear });
  return outcome(code, clear ? "steering cleared" : "steering applies to the next session launched", "could not write steering");
}

export function doUnblock(ctx: ApiContext, id: string, keepAttempts: boolean): ActionResult {
  return outcome(unblock({ layout: ctx.layout, milestoneId: id, keepAttempts }), `${id} set to pending`, `could not unblock ${id}`);
}

export async function doKill(ctx: ApiContext, reason: string): Promise<ActionResult> {
  const code = await kill({ layout: ctx.layout, reason, rule: "web" });
  return outcome(code, "agent session killed; the runner will retry", "nothing to kill");
}

export function doAttend(ctx: ApiContext, seconds: number | undefined): ActionResult {
  return outcome(attend({ config: ctx.config, layout: ctx.layout, seconds, rule: "web" }), "environment adapter finished", "environment adapter failed");
}

/**
 * The runner is spawned detached rather than hosted in this process: closing the panel must not end
 * an overnight run, and everything that manages a running runner - pulse.json, kill, the two-stage
 * interrupt - already works on a separate process.
 */
export function startRun(ctx: ApiContext, noLint = false): ActionResult {
  const pulse = readPulse(ctx.layout.pulse);
  if (pulse && isProcessAlive(pulse.pid)) return { ok: false, message: `a runner is already running (pid ${pulse.pid})` };

  // Lint here, synchronously: the runner is spawned detached with stdio ignored, so its own gate
  // (D-035) would refuse into the void and the panel would report a runner that is already dead.
  if (!noLint) {
    const state = loadState(ctx.layout.state);
    const findings = lintRun(collectLintInput(ctx.config, ctx.layout, state));
    const gating = gatingFindings(state, findings);
    if (gating.length > 0) {
      const first = gating.slice(0, 3).map((f) => `${f.milestone} ${f.rule}: ${f.message}`).join("; ");
      return {
        ok: false,
        lintRefused: true,
        message:
          `refusing to start: ${lintTotals(findings).summary}, with error-level findings on pending milestones - ` +
          `${first}${gating.length > 3 ? "; ..." : ""}`,
      };
    }
  }

  const child = spawn(process.execPath, [ctx.cliPath, "run", ...(noLint ? ["--no-lint"] : [])], {
    cwd: ctx.config.projectRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  return { ok: true, message: `runner started (pid ${child.pid})` };
}

/** SIGINT, not SIGTERM: one interrupt is the runner's own "finish this session, then stop". */
export function stopRun(ctx: ApiContext): ActionResult {
  const pulse = readPulse(ctx.layout.pulse);
  if (!pulse || !isProcessAlive(pulse.pid)) return { ok: false, message: "no runner is running" };
  try {
    process.kill(pulse.pid, "SIGINT");
    return { ok: true, message: "stopping after the current session finishes" };
  } catch {
    return { ok: false, message: `could not signal pid ${pulse.pid}` };
  }
}

