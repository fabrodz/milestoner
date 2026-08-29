import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { layoutFor } from "../paths.js";
import { ensureDir, writeJsonAtomic } from "../util/fs.js";
import { transcript } from "./transcript.js";

function capture(fn: () => number): { code: number; out: string } {
  const log = console.log;
  const err = console.error;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  };
  try {
    return { code: fn(), out };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const stream = (blocks: string[]): string =>
  [
    JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", model: "claude-opus-5", tools: "x".repeat(2000) }),
    ...blocks.map((text) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })),
  ].join("\n");

function scaffold(): { root: string; layout: ReturnType<typeof layoutFor> } {
  const root = mkdtempSync(join(tmpdir(), "milestoner-transcript-"));
  const layout = layoutFor(root);
  ensureDir(layout.logs);
  return { root, layout };
}

const read = (root: string, layout: ReturnType<typeof layoutFor>, over: Partial<Parameters<typeof transcript>[0]> = {}) =>
  capture(() => transcript({ layout, projectRoot: root, raw: false, ...over }));

test("with no arguments it reads the session the pulse names", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M01-old.log"), stream(["the earlier attempt"]));
  writeFileSync(join(layout.logs, "M02-live.log"), stream(["what it is doing now"]));
  writeJsonAtomic(layout.pulse, {
    pid: process.pid,
    run: "t",
    startedAt: new Date().toISOString(),
    milestoneId: "M02",
    attempt: 1,
    sessionStartedAt: new Date().toISOString(),
    agentPid: null,
    agent: null,
    model: null,
    transcript: join(".milestoner", "logs", "M02-live.log"),
    lastEvent: "session-start",
    lastEventAt: new Date().toISOString(),
  });

  const { code, out } = read(root, layout);
  assert.equal(code, 0);
  assert.match(out, /what it is doing now/);
  assert.doesNotMatch(out, /the earlier attempt/, "the session in flight, not whichever file sorts first");
  assert.doesNotMatch(out, /"type":|tools/, "and rendered, not dumped");
});

test("with no pulse it falls back to the newest log, so it still answers after a run ends", () => {
  const { root, layout } = scaffold();
  const older = join(layout.logs, "M01-old.log");
  writeFileSync(older, stream(["the earlier attempt"]));
  const newer = join(layout.logs, "M02-last.log");
  writeFileSync(newer, stream(["the last thing that happened"]));
  // mtime decides, not the name: an attempt 10 sorts before attempt 9.
  const past = new Date(Date.now() - 60_000);
  utimesSync(older, past, past);

  const { code, out } = read(root, layout);
  assert.equal(code, 0);
  assert.match(out, /the last thing that happened/);
});

test("--name reads a past attempt, and cannot be pointed outside the logs directory", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M01-old.log"), stream(["the earlier attempt"]));
  writeFileSync(join(root, "secrets.txt"), "not a transcript");

  assert.match(read(root, layout, { name: "M01-old.log" }).out, /the earlier attempt/);

  const escaped = read(root, layout, { name: join("..", "..", "secrets.txt") });
  assert.equal(escaped.code, 1, "a traversal spelling is refused, not followed");
  assert.doesNotMatch(escaped.out, /not a transcript/);
});

test("--lines keeps the end, which is where a session says how it went", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M01.log"), stream(["first", "second", "third"]));

  const { out } = read(root, layout, { lines: 1 });
  assert.match(out, /third/);
  assert.doesNotMatch(out, /first/);
});

test("--raw prints the file as written, for when the rendering is the thing in the way", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M01.log"), stream(["hello"]));

  const { out } = read(root, layout, { raw: true });
  assert.match(out, /"type":"assistant"/);
});

test("an empty logs directory is said plainly rather than crashed on", () => {
  const { root, layout } = scaffold();
  const { code, out } = read(root, layout);
  assert.equal(code, 1);
  assert.match(out, /no transcript to read/);
});

test("it says which session it read, and whether that session is still going", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M02-live.log"), stream(["what it is doing now"]));
  const now = new Date().toISOString();
  writeJsonAtomic(layout.pulse, {
    pid: process.pid,
    run: "t",
    startedAt: now,
    milestoneId: "M02",
    attempt: 2,
    sessionStartedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
    agentPid: null,
    agent: null,
    model: null,
    transcript: join(".milestoner", "logs", "M02-live.log"),
    lastEvent: "session-start",
    lastEventAt: now,
  });

  // A supervisor quoting a transcript in an intervention has to know it quoted the running one.
  assert.match(read(root, layout).out, /M02-live\.log - live on M02 attempt 2, 14m .*in/);

  writeFileSync(join(layout.logs, "M01-over.log"), stream(["the earlier attempt"]));
  assert.match(read(root, layout, { name: "M01-over.log" }).out, /this one has ended/);
});

test("--raw stays a clean dump, so the heading cannot corrupt a pipe", () => {
  const { root, layout } = scaffold();
  writeFileSync(join(layout.logs, "M01.log"), stream(["hello"]));

  const out = read(root, layout, { raw: true }).out;
  assert.doesNotMatch(out, /this one has ended|- live/);
  assert.ok(out.trimEnd().split("\n").every((l) => l.startsWith("{")), "every line is a line of the file");
});
