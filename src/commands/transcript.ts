import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, relative } from "node:path";
import type { Layout } from "../paths.js";
import { isProcessAlive, readPulse } from "../pulse.js";
import { renderTranscript } from "../transcript.js";
import { color, fail, humanDuration } from "../util/log.js";

export interface TranscriptOptions {
  layout: Layout;
  projectRoot: string;
  name?: string;
  lines?: number;
  raw: boolean;
}

/** Bytes read off the end of the file. Enough for a long session's recent history, small enough
 *  that a supervisor reading this every cycle is not paying for the whole run. */
const TAIL_BYTES = 200_000;

function newestTranscript(logs: string): string | null {
  try {
    const files = readdirSync(logs)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ file: join(logs, f), mtime: statSync(join(logs, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.file ?? null;
  } catch {
    return null;
  }
}

/**
 * What the running session is doing, in words.
 *
 * The default target is the transcript the pulse names, which is the session in flight - the whole
 * question a supervisor has. It falls back to the newest log so the command still answers after a
 * run ends, and takes an explicit `--name` for any past attempt.
 *
 * This is a read, and only a read. It is deliberately outside the supervisor's intervention set:
 * knowing what a session is doing has to be free, or it will not be done every cycle.
 */
export function transcript(options: TranscriptOptions): number {
  const pulse = readPulse(options.layout.pulse);
  const target = options.name
    ? resolve(options.layout.logs, basename(options.name))
    : pulse?.transcript
      ? resolve(options.projectRoot, pulse.transcript)
      : newestTranscript(options.layout.logs);

  if (!target) {
    fail(`no transcript to read - nothing in ${relative(options.projectRoot, options.layout.logs)} yet`);
    return 1;
  }
  // The name can arrive from a supervisor pasting whatever it read; keep it inside the logs dir.
  if (relative(options.layout.logs, target).startsWith("..")) {
    fail(`${target} is not in this run's logs directory`);
    return 1;
  }
  if (!existsSync(target)) {
    fail(`no such transcript: ${relative(options.projectRoot, target)}`);
    return 1;
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf8").slice(-TAIL_BYTES);
  } catch (err) {
    fail(`could not read ${relative(options.projectRoot, target)}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const body = options.raw ? raw : renderTranscript(raw);
  const lines = body.split("\n");
  const shown = options.lines && options.lines < lines.length ? lines.slice(-options.lines).join("\n") : body;

  // Which session this is, before what it said. A supervisor that quotes a transcript in an
  // intervention has to be sure it quoted the running one, and the fallback path can hand it a
  // finished session that reads exactly like a live one.
  if (!options.raw) console.log(color.dim(heading(options, target, pulse)));
  console.log(shown.trimEnd() || "nothing in it yet - the session has not written its first event");
  return 0;
}

function heading(options: TranscriptOptions, target: string, pulse: ReturnType<typeof readPulse>): string {
  const where = relative(options.projectRoot, target);
  const live =
    pulse !== null &&
    isProcessAlive(pulse.pid) &&
    pulse.transcript !== null &&
    resolve(options.projectRoot, pulse.transcript) === target;
  if (!live) return `${where} - not the session in flight; this one has ended`;
  const on = pulse.milestoneId ? ` on ${pulse.milestoneId}${pulse.attempt === null ? "" : ` attempt ${pulse.attempt}`}` : "";
  const age = pulse.sessionStartedAt ? `, ${humanDuration(Date.now() - Date.parse(pulse.sessionStartedAt))} in` : "";
  return `${where} - live${on}${age}`;
}
