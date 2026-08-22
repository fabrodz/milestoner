import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { appendMilestone } from "../add.js";
import { attend } from "../commands/attend.js";
import { init } from "../commands/init.js";
import { kill } from "../commands/kill.js";
import { collectLintInput, gatingFindings, lintTotals } from "../commands/lint.js";
import { steer } from "../commands/steer.js";
import { unblock } from "../commands/unblock.js";
import { mergeConfig } from "../config.js";
import { lintRun, type LintFinding } from "../lint.js";
import type { Layout } from "../paths.js";
import { recordProject } from "../projects.js";
import { isProcessAlive, newestSignal, readPulse } from "../pulse.js";
import { buildReport } from "../report.js";
import { loadState, summarize } from "../state.js";
import { readInterventions } from "../supervisorLog.js";
import type { MilestonerConfig, RunState } from "../types.js";
import { writeJsonAtomic, writeTextAtomic } from "../util/fs.js";

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
      prompt: m.prompt,
      status: m.status,
      attempts: m.attempts,
      evidence: m.evidence,
      diagnosis: m.diagnosis,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      history: m.history,
      model: ctx.config.models[m.id] ?? null,
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
    supervisorLog: readInterventions(ctx.layout.supervisorLog, 20),
    transcripts: state.milestones.flatMap((m) => m.history.map((h) => h.transcript)).slice(-25),
  };
}

/**
 * The same renderer `milestoner report` writes to disk. `panelHref` is the one difference between
 * the two consumers: served from a panel the report links back to it, and the file version passes
 * none so it never carries a link that needs a server to exist.
 */
export function reportHtml(ctx: ApiContext, panelHref?: string): string {
  const state = loadState(ctx.layout.state);
  return buildReport({
    state,
    maxAttempts: ctx.config.maxAttempts,
    runLog: tail(ctx.layout.runLog, 200).filter((l) => !l.startsWith("#") && !l.startsWith("`")),
    supervisorLog: readInterventions(ctx.layout.supervisorLog, 100),
    generatedAt: new Date(),
    panelHref,
  });
}

/**
 * Transcripts are served by name only, resolved inside the logs directory and checked afterwards.
 * The name arrives over HTTP, so treating it as a path is how a caller reads /etc/passwd.
 */
export function transcript(ctx: ApiContext, name: string): string | null {
  const file = resolve(ctx.layout.logs, basename(name));
  if (relative(ctx.layout.logs, file).startsWith("..")) return null;
  try {
    // An empty name resolves to the logs directory itself, which read as a file is EISDIR, not a 404.
    return statSync(file).isFile() ? readFileSync(file, "utf8").slice(-200_000) : null;
  } catch {
    return null;
  }
}

/**
 * A prompt file this run owns, or null. The name arrives over HTTP, so it gets the transcript()
 * treatment - resolved inside the prompts directory, checked with relative - plus one stricter
 * rule: only a name some milestone's `prompt` field carries verbatim counts. A traversal spelling
 * is refused outright rather than quietly rewritten to the file it happens to end in.
 */
function ownedPromptFile(ctx: ApiContext, name: string): string | null {
  if (!name.endsWith(".md") || basename(name) !== name) return null;
  const state = loadState(ctx.layout.state);
  if (!state.milestones.some((m) => m.prompt === name)) return null;
  const file = resolve(ctx.layout.prompts, name);
  return relative(ctx.layout.prompts, file).startsWith("..") ? null : file;
}

export function readPromptFile(ctx: ApiContext, name: string): string | null {
  const file = ownedPromptFile(ctx, name);
  if (!file) return null;
  try {
    return statSync(file).isFile() ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Prompts and the protocol are hand-written prose by design (D-031/D-035), so no structure is
 * checked before writing: the linter is the feedback, never a write gate. The shape checks here
 * mirror writeConfig's - a name the run owns, a document that is text.
 */
export function writePrompt(ctx: ApiContext, name: unknown, content: unknown): ActionResult {
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, message: "name is required: the prompt file as state names it, like M01.md" };
  }
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, message: "content is required: the whole prompt document, as text" };
  }
  const file = ownedPromptFile(ctx, name);
  if (!file) return { ok: false, message: `no milestone in this run has "${name}" as its prompt file` };
  writeTextAtomic(file, content);
  return { ok: true, message: "prompt saved - a session already running got its kickoff at launch, so this applies to the next one" };
}

/** The protocol exactly as it is on disk, or null if it has gone missing under a long-lived panel. */
export function readProtocolFile(ctx: ApiContext): string | null {
  try {
    return readFileSync(ctx.layout.protocol, "utf8");
  } catch {
    return null;
  }
}

export function writeProtocol(ctx: ApiContext, content: unknown): ActionResult {
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, message: "content is required: the whole protocol.md document, as text" };
  }
  writeTextAtomic(ctx.layout.protocol, content);
  return { ok: true, message: "protocol saved - a session already running read it at launch, so this applies to the next one" };
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
  /** True when an init was refused by something `force` answers, so the panel can offer it. */
  forceable?: boolean;
  /** The project root an init scaffolded, so the hub can open it. */
  root?: string;
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

/** One milestone per call, appended through the same locked primitive the CLI uses. */
export function doAddMilestone(ctx: ApiContext, title: unknown): ActionResult {
  if (title !== undefined && typeof title !== "string") {
    return { ok: false, message: "title must be text, or absent for the scaffold placeholder" };
  }
  try {
    const added = appendMilestone(ctx.layout, title);
    const prompt = `.milestoner/prompts/${added.promptFile}`;
    return {
      ok: true,
      message:
        `${added.id} added as pending - ` +
        (added.promptCreated ? `write ${prompt} before its turn comes` : `${prompt} already existed and was kept`) +
        (added.runResumed ? "; the run was complete and has work again" : ""),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function doKill(ctx: ApiContext, reason: string): Promise<ActionResult> {
  const code = await kill({ layout: ctx.layout, reason, rule: "web" });
  return outcome(code, "agent session killed; the runner will retry", "nothing to kill");
}

export function doAttend(ctx: ApiContext, seconds: number | undefined): ActionResult {
  return outcome(attend({ config: ctx.config, layout: ctx.layout, seconds, rule: "web" }), "environment adapter finished", "environment adapter failed");
}

/** The config exactly as it is on disk, or null if it has gone missing under a long-lived panel. */
export function readConfigFile(ctx: ApiContext): string | null {
  try {
    return readFileSync(ctx.layout.config, "utf8");
  } catch {
    return null;
  }
}

/**
 * Replace `config.json` with a submitted document. The validator is `mergeConfig` - the checks
 * `loadConfig` runs on every start - so nothing is written that the next runner would refuse to
 * load, and its message is returned verbatim rather than reworded into a second set of rules.
 * `projectRoot` is dropped instead of written: it is where the config was found, never what it says.
 */
export function writeConfig(ctx: ApiContext, content: unknown): ActionResult {
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, message: "content is required: the whole config.json document, as text" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { ok: false, message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  let merged: MilestonerConfig;
  try {
    merged = mergeConfig(parsed as Partial<MilestonerConfig>, ctx.layout.config, ctx.config.projectRoot);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const { projectRoot: _root, ...document } = parsed as Partial<MilestonerConfig>;
  writeJsonAtomic(ctx.layout.config, document);
  // A project panel resolved its context once, at construction, so without this the snapshot and
  // the controls would go on answering from the config as it was before this write.
  ctx.config = merged;
  return { ok: true, message: "config saved - a runner already running loaded its own copy at startup, so this applies to the next one" };
}

/** Everything a start may carry, straight off the request body: the values are checked here. */
export interface StartOptions {
  noLint?: boolean;
  milestone?: unknown;
  once?: unknown;
  maxAttempts?: unknown;
  model?: unknown;
}

/**
 * The options as CLI flags, or the first thing wrong with them. Validated in this process because
 * the runner is spawned detached with stdio ignored: a flag it would reject fails into the void.
 */
function startFlags(state: RunState, options: StartOptions): { args: string[] } | { error: string } {
  const args: string[] = [];

  if (options.milestone !== undefined) {
    const id = typeof options.milestone === "string" ? options.milestone.trim() : "";
    if (!id) return { error: "milestone must be the id of a milestone in this run" };
    if (!state.milestones.some((m) => m.id === id)) return { error: `milestone: no milestone with id "${id}"` };
    args.push("--milestone", id);
  }

  if (options.once !== undefined && typeof options.once !== "boolean") return { error: "once must be true or false" };
  if (options.once === true) args.push("--once");

  if (options.maxAttempts !== undefined) {
    const n = options.maxAttempts;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return { error: "maxAttempts must be a positive integer" };
    args.push("--max-attempts", String(n));
  }

  if (options.model !== undefined) {
    const model = typeof options.model === "string" ? options.model.trim() : "";
    if (!model) return { error: "model must be a non-empty string" };
    args.push("--model", model);
  }

  return { args };
}

/**
 * The runner is spawned detached rather than hosted in this process: closing the panel must not end
 * an overnight run, and everything that manages a running runner - pulse.json, kill, the two-stage
 * interrupt - already works on a separate process.
 */
export function startRun(ctx: ApiContext, options: StartOptions = {}): ActionResult {
  const pulse = readPulse(ctx.layout.pulse);
  if (pulse && isProcessAlive(pulse.pid)) return { ok: false, message: `a runner is already running (pid ${pulse.pid})` };

  const state = loadState(ctx.layout.state);
  const flags = startFlags(state, options);
  if ("error" in flags) return { ok: false, message: flags.error };

  // Lint here, synchronously: the runner is spawned detached with stdio ignored, so its own gate
  // (D-035) would refuse into the void and the panel would report a runner that is already dead.
  if (!options.noLint) {
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

  const child = spawn(process.execPath, [ctx.cliPath, "run", ...flags.args, ...(options.noLint ? ["--no-lint"] : [])], {
    cwd: ctx.config.projectRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  return { ok: true, message: `runner started (pid ${child.pid})` };
}

/** Everything an init may carry, straight off the request body. */
export interface InitRequest {
  path?: unknown;
  run?: unknown;
  milestones?: unknown;
  force?: unknown;
}

/** The bounds `cli.ts` puts on `--milestones`, so the two front ends refuse the same numbers. */
const MIN_MILESTONES = 1;
const MAX_MILESTONES = 99;

/**
 * Scaffold a project the panel names by path. Nothing here decides whether scaffolding is allowed:
 * that is the auth layer's job, argued in D-038. This validates the body and hands the rest to the
 * same `init()` the CLI calls, so the refusals - an existing config, a protocol naming another run
 * (D-030) - are the CLI's refusals rather than a second set that can drift from them.
 */
export function initProject(body: InitRequest, projectsFile: string): ActionResult {
  if (typeof body.path !== "string" || body.path.trim() === "") {
    return { ok: false, message: "path is required: the absolute path of the directory to scaffold" };
  }
  const dir = body.path.trim();
  if (!isAbsolute(dir)) return { ok: false, message: `path must be absolute, and "${dir}" is not` };

  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    return { ok: false, message: `no such directory: ${dir} - create it first, this never makes one` };
  }
  if (!isDirectory) return { ok: false, message: `${dir} is not a directory` };

  let run: string | undefined;
  if (body.run !== undefined) {
    if (typeof body.run !== "string" || body.run.trim() === "") {
      return { ok: false, message: "run must be a non-empty name, or absent to take it from the directory" };
    }
    run = body.run.trim();
  }

  let count = 3;
  if (body.milestones !== undefined) {
    const n = body.milestones;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_MILESTONES || n > MAX_MILESTONES) {
      return { ok: false, message: `milestones must be an integer between ${MIN_MILESTONES} and ${MAX_MILESTONES}` };
    }
    count = n;
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    return { ok: false, message: "force must be true or false" };
  }
  const force = body.force === true;

  const root = resolve(dir);
  const result = init({ projectRoot: root, run, count, force });
  if (result.code !== 0) return { ok: false, message: result.message, forceable: result.refusal === "config-exists" };

  recordProject(projectsFile, root);
  return { ok: true, message: result.message, root };
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

