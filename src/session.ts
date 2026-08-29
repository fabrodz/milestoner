import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { delimiter, extname, join, sep } from "node:path";
import { isProcessAlive } from "./pulse.js";
import { parseEvent } from "./transcript.js";
import { ensureDir, fileSize } from "./util/fs.js";
import type { InfraConfig } from "./types.js";
import { secondsUntilReset } from "./util/time.js";

const isWindows = process.platform === "win32";

/** How long a session gets to honour SIGTERM before the group is killed outright. */
export const KILL_GRACE_MS = 5000;

/** Resolve a bare command name against PATH/PATHEXT so we know whether we are launching a shim. */
export function resolveExecutable(command: string): string {
  if (command.includes(sep) || command.includes("/") || (isWindows && extname(command))) return command;
  if (!isWindows) return command;
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

/**
 * Quote an argument for a cmd.exe shim (`claude.cmd` when the CLI is installed through npm).
 * cmd does not understand the MSVCRT `\"` escape: it reads the quote as closing the quoted region,
 * which leaves any `&` or `|` in a kickoff prompt to be parsed as an operator. Doubling the quote
 * keeps the region open for cmd and still arrives at the target program as one literal quote.
 */
export function quoteCmdArg(arg: string): string {
  return `"${arg.replaceAll('"', '""')}"`;
}

/** `%` is the one character cmd expands that cannot be escaped on a command line. */
export function hasUnescapablePercent(args: string[]): boolean {
  return args.some((a) => /%\w+%/.test(a));
}

export interface SessionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  transcript: string;
  /** Called with the agent process id, so a supervisor can reach the session without the runner. */
  onSpawn?: (pid: number | undefined) => void;
  /** Called about once a minute with the elapsed milliseconds, for the heartbeat line. */
  onTick?: (elapsedMs: number) => void;
  tickSeconds?: number;
  signal?: AbortSignal;
  /** Grace between the abort's SIGTERM and the SIGKILL that follows it. Tests shorten it. */
  killGraceMs?: number;
}

/**
 * Signal the session's whole process tree, not just the process the engine spawned. An agent is
 * routinely reached through a wrapper - an npm shim, a login shell, a `claude` launcher - so
 * signalling the pid alone leaves the agent itself running and the intervention does nothing.
 *
 * POSIX: the negative pid is the process group, which the session leads because `runSession`
 * spawns it `detached`. The bare pid is the fallback for a process that never got its own group.
 * Windows: `taskkill /T /F` already walks the tree, and has no gentler step to offer.
 */
export function terminateSessionTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (isWindows) return spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" }).status === 0;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * SIGTERM the tree, then SIGKILL whatever is still there. Without the escalation a session that
 * traps or ignores SIGTERM leaves the caller believing it killed something.
 */
export async function killSessionTree(pid: number, graceMs = KILL_GRACE_MS): Promise<boolean> {
  const signalled = terminateSessionTree(pid, "SIGTERM");
  if (isWindows || !signalled) return signalled;
  await waitForExit(pid, graceMs);
  if (isProcessAlive(pid)) terminateSessionTree(pid, "SIGKILL");
  return true;
}

async function waitForExit(pid: number, graceMs: number, stepMs = 100): Promise<void> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((r) => setTimeout(r, Math.min(stepMs, Math.max(0, deadline - Date.now()))));
  }
}

export interface SessionOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  ms: number;
  transcript: string;
  bytes: number;
}

export function runSession(options: SessionOptions): Promise<SessionOutcome> {
  ensureDir(options.cwd);
  const out = createWriteStream(options.transcript, { flags: "a" });
  const started = Date.now();

  const exe = resolveExecutable(options.command);
  const useCmdShim = isWindows && [".cmd", ".bat"].includes(extname(exe).toLowerCase());
  if (useCmdShim && hasUnescapablePercent(options.args)) {
    console.warn(`warning: ${exe} is a cmd shim and an argument contains %VAR% - cmd will expand it`);
  }

  const child = useCmdShim
    ? spawn(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `"${[exe, ...options.args].map(quoteCmdArg).join(" ")}"`],
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          windowsVerbatimArguments: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    : spawn(exe, options.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        // Its own process group on POSIX, so an abort or a `milestoner kill` can reach everything
        // the session started. See D-026 for what this costs: the terminal's Ctrl-C no longer
        // reaches the agent, and the engine's explicit kill is the only thing that ends it.
        detached: !isWindows,
        stdio: ["ignore", "pipe", "pipe"],
      });

  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  options.onSpawn?.(child.pid);

  const tickMs = (options.tickSeconds ?? 60) * 1000;
  const ticker = options.onTick ? setInterval(() => options.onTick!(Date.now() - started), tickMs) : null;
  let escalation: NodeJS.Timeout | null = null;
  const onAbort = () => {
    const pid = child.pid;
    if (pid === undefined) return;
    terminateSessionTree(pid, "SIGTERM");
    if (isWindows) return;
    escalation = setTimeout(() => terminateSessionTree(pid, "SIGKILL"), options.killGraceMs ?? KILL_GRACE_MS);
    escalation.unref();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise((resolve, reject) => {
    child.on("error", (err) => {
      finish();
      reject(new Error(`failed to launch "${options.command}": ${err.message}`));
    });
    child.on("close", (code, signal) => {
      finish();
      resolve({
        exitCode: code,
        signal,
        ms: Date.now() - started,
        transcript: options.transcript,
        bytes: fileSize(options.transcript),
      });
    });

    function finish() {
      if (ticker) clearInterval(ticker);
      // Cleared before the pid can be recycled: the escalation holds a pid, not a handle.
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener("abort", onAbort);
      out.end();
    }
  });
}

export interface InfraVerdict {
  reason: "usage-limit" | "agent-failure" | "instant-death" | "crash";
  waitSeconds: number;
  detail: string;
}

export interface InfraInput {
  seconds: number;
  bytes: number;
  /** Bytes of agent output, with the harness's own protocol discounted. Defaults to `bytes`, which
   *  is what a plain-text transcript is: all of it is the agent talking. */
  workBytes?: number;
  /** The agent stating outright that its quota is gone, rather than a substring suggesting it.
   *  `resetsAt` is epoch seconds when the agent named a time. */
  usageLimit?: { resetsAt: number | null } | null;
  text: string;
  wroteResult: boolean;
}

/**
 * A session that dies almost instantly with a tiny transcript is infrastructure (usage limit,
 * auth, network), not a milestone failure, and must not consume an attempt. The MVP run burned
 * three attempts in forty seconds against a usage limit before this rule existed.
 *
 * The tiny-transcript rule alone is a Claude Code shape. Other agents narrate their own failure at
 * length - a model endpoint that never answered can leave kilobytes of retry chatter - so the text
 * patterns are what carry the rule across agents.
 *
 * The duration bound only guards the rules above. A transcript below crashTranscriptBytes carries
 * no verdict, no diagnosis and no narration, so it is a crash whatever the clock says: an agent
 * that worked for fifteen minutes and then fell over leaving fifteen bytes did not fail the
 * milestone. See D-029.
 */
export function classifyInfraFailure(input: InfraInput, infra: InfraConfig, now: Date = new Date()): InfraVerdict | null {
  if (input.wroteResult) return null;

  const evidence = input.workBytes ?? input.bytes;
  const size = (n: number) => (n === input.bytes ? `${n}-byte` : `${n}-byte (of ${input.bytes})`);

  // Deliberately outside the deathSeconds bound the patterns sit behind. This is not a substring
  // that suggests a usage limit, it is the agent reporting one, and a quota that ran out forty
  // minutes in explains a missing result.json exactly as well as one that was gone at launch.
  if (input.usageLimit) {
    const untilReset = input.usageLimit.resetsAt === null ? null : Math.max(0, Math.round(input.usageLimit.resetsAt - now.getTime() / 1000));
    return {
      reason: "usage-limit",
      waitSeconds: untilReset ?? infra.usageLimitWaitSeconds,
      detail: untilReset
        ? `the agent reported its quota gone, waiting ${Math.round(untilReset / 60)}m for the announced reset`
        : "the agent reported its quota gone, with no reset time",
    };
  }

  if (input.seconds < infra.deathSeconds) {
    const haystack = input.text.toLowerCase();
    const matches = (patterns: string[]) => patterns.find((p) => haystack.includes(p.toLowerCase()));
    const hitLimit = matches(infra.usageLimitPatterns);

    if (hitLimit) {
      const untilReset = secondsUntilReset(input.text, now);
      return {
        reason: "usage-limit",
        waitSeconds: untilReset ?? infra.usageLimitWaitSeconds,
        detail: untilReset ? `waiting ${Math.round(untilReset / 60)}m for the announced reset` : "no usable reset time in the transcript",
      };
    }

    // Checked after the usage limit: a transcript can carry both, and the announced reset is the
    // more useful of the two.
    const hitFailure = matches(infra.infraFailurePatterns ?? []);
    if (hitFailure) {
      return {
        reason: "agent-failure",
        waitSeconds: infra.genericWaitSeconds,
        detail: `the agent reported "${hitFailure}" after ${Math.round(input.seconds)}s`,
      };
    }

    if (evidence < infra.tinyTranscriptBytes) {
      return {
        reason: "instant-death",
        waitSeconds: infra.genericWaitSeconds,
        detail: `died in ${Math.round(input.seconds)}s with a ${size(evidence)} transcript`,
      };
    }
  }

  if (evidence < infra.crashTranscriptBytes) {
    return {
      reason: "crash",
      waitSeconds: infra.genericWaitSeconds,
      detail: `crashed after ${Math.round(input.seconds)}s with a ${size(evidence)} transcript`,
    };
  }

  return null;
}

/** stream-json events that are the harness talking, not the agent working. */
const PROTOCOL_EVENTS = new Set(["system", "result", "rate_limit_event"]);

/** Work past this is not counted. The number only has to be exact near the infra thresholds, and a
 *  session that ran for hours writes megabytes nobody needs to weigh. */
const WORK_CAP = 64_000;

export interface TranscriptEvidence {
  /** Bytes the agent produced. The file size for a plain-text transcript, protocol discounted for
   *  a stream-json one, capped once it is plainly past anything a threshold asks about. */
  bytes: number;
  /** The tail the infra patterns are searched in, preamble removed. */
  text: string;
  usageLimit: { resetsAt: number | null } | null;
}

function exhaustedQuota(event: Record<string, unknown>): { resetsAt: number | null } | null {
  const info = event.rate_limit_info as { status?: unknown; resetsAt?: unknown } | undefined;
  // Only "rejected" is the quota being gone. "allowed_warning" is the CLI saying the limit is near
  // and the session runs straight through it; read as exhaustion it sleeps out a reset that never
  // applied. `overageStatus` sits in the same object and answers a different question.
  if (!info || typeof info !== "object" || info.status !== "rejected") return null;
  return { resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : null };
}

/**
 * What a transcript is evidence of, separated from what the harness printed around it.
 *
 * A plain-text transcript is all agent output, so `bytes` is its size and every rule in
 * `classifyInfraFailure` behaves exactly as it always has. A stream-json transcript is not. It
 * opens with a four-kilobyte `system`/`init` inventory of tools, slash commands, agents and paths,
 * written before the agent has done anything, and closes with a `result` envelope of counters.
 * Counted as evidence, those two alone put every session over every threshold however instantly it
 * died, which is D-029 switched off. Searched for patterns, the inventory matches `not logged
 * in` or `429` on the strength of somebody's skill description. So the preamble is dropped from
 * both, and the envelope only from the byte count: it carries the agent's closing words, which are
 * exactly where a failure names itself.
 */
export function readTranscriptEvidence(file: string, maxTextBytes = 20_000): TranscriptEvidence {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { bytes: 0, text: "", usageLimit: null };
  }

  const lines = raw.split("\n");
  let bytes = 0;
  let usageLimit: { resetsAt: number | null } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const counting = bytes < WORK_CAP;
    // Past the cap only one event is still worth finding, and it names itself in its own text.
    if (!counting && !line.includes('"rate_limit_event"')) continue;
    const event = parseEvent(line);
    const type = event ? String(event.type) : null;
    // The last event wins: a quota rejected early and allowed again is not the quota that ended
    // the session. Past the cap only these lines are parsed, so the last one is still the last one.
    if (type === "rate_limit_event") usageLimit = exhaustedQuota(event!);
    if (counting && (type === null || !PROTOCOL_EVENTS.has(type))) {
      bytes += Buffer.byteLength(line) + (i === lines.length - 1 ? 0 : 1);
    }
  }

  const text = (raw.length > maxTextBytes ? raw.slice(-maxTextBytes) : raw)
    .split("\n")
    .map((line) => {
      const event = parseEvent(line);
      if (!event) return line;
      if (event.type === "system") return null;
      // The envelope's counters are digits, not prose: a cost or a hex uuid carries `429` as
      // readily as a rate limit does. Only what the session closed with is searched, and
      // api_error_status is where a real one lands.
      if (event.type === "result") {
        return [event.result, event.subtype, event.api_error_status].filter((v) => typeof v === "string").join(" ");
      }
      return line;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  return { bytes, text, usageLimit };
}
