import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, extname, join, sep } from "node:path";
import { ensureDir, fileSize } from "./util/fs.js";
import type { InfraConfig } from "./types.js";
import { secondsUntilReset } from "./util/time.js";

const isWindows = process.platform === "win32";

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
        stdio: ["ignore", "pipe", "pipe"],
      });

  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  options.onSpawn?.(child.pid);

  const tickMs = (options.tickSeconds ?? 60) * 1000;
  const ticker = options.onTick ? setInterval(() => options.onTick!(Date.now() - started), tickMs) : null;
  const onAbort = () => child.kill("SIGTERM");
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
      options.signal?.removeEventListener("abort", onAbort);
      out.end();
    }
  });
}

export interface InfraVerdict {
  reason: "usage-limit" | "instant-death";
  waitSeconds: number;
  detail: string;
}

export interface InfraInput {
  seconds: number;
  bytes: number;
  text: string;
  wroteResult: boolean;
}

/**
 * A session that dies almost instantly with a tiny transcript is infrastructure (usage limit,
 * auth, network), not a milestone failure, and must not consume an attempt. The MVP run burned
 * three attempts in forty seconds against a usage limit before this rule existed.
 */
export function classifyInfraFailure(input: InfraInput, infra: InfraConfig, now: Date = new Date()): InfraVerdict | null {
  if (input.wroteResult) return null;
  if (input.seconds >= infra.deathSeconds) return null;

  const haystack = input.text.toLowerCase();
  const hitLimit = infra.usageLimitPatterns.some((p) => haystack.includes(p.toLowerCase()));

  if (hitLimit) {
    const untilReset = secondsUntilReset(input.text, now);
    return {
      reason: "usage-limit",
      waitSeconds: untilReset ?? infra.usageLimitWaitSeconds,
      detail: untilReset ? `waiting ${Math.round(untilReset / 60)}m for the announced reset` : "no usable reset time in the transcript",
    };
  }

  if (input.bytes < infra.tinyTranscriptBytes) {
    return {
      reason: "instant-death",
      waitSeconds: infra.genericWaitSeconds,
      detail: `died in ${Math.round(input.seconds)}s with a ${input.bytes}-byte transcript`,
    };
  }

  return null;
}

export function readTranscriptTail(file: string, maxBytes = 4000): string {
  try {
    const size = statSync(file).size;
    const text = readFileSync(file, "utf8");
    return size <= maxBytes ? text : text.slice(-maxBytes);
  } catch {
    return "";
  }
}
