import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { kill } from "./commands/kill.js";
import { layoutFor } from "./paths.js";
import { isProcessAlive } from "./pulse.js";
import { killSessionTree, runSession, terminateSessionTree } from "./session.js";
import type { Pulse } from "./types.js";

// The shape that made this milestone necessary: the engine spawns a wrapper, the wrapper is what
// actually launches the agent, and signalling the wrapper's pid alone leaves the agent running.
const GRANDCHILD = `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`;

const WRAPPER = `
import { spawn } from "node:child_process";
spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: "ignore" });
console.log("wrapper up");
setInterval(() => {}, 1000);
`;

// Ignores the polite signal, so only the escalation can end it.
const STUBBORN = `
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
`;

interface Fixture {
  root: string;
  pidFile: string;
  args: string[];
  transcript: string;
}

function scaffold(name: string, scripts: Record<string, string>, entry: string[]): Fixture {
  const root = mkdtempSync(join(tmpdir(), "milestoner-kill-"));
  mkdirSync(layoutFor(root).logs, { recursive: true });
  for (const [file, body] of Object.entries(scripts)) writeFileSync(join(root, file), body);
  const pidFile = join(root, "reported.pid");
  return {
    root,
    pidFile,
    args: entry.map((a) => (a === "{{pid}}" ? pidFile : join(root, a))),
    transcript: join(layoutFor(root).logs, `${name}.log`),
  };
}

const wrapperFixture = (name: string) =>
  scaffold(name, { "wrapper.mjs": WRAPPER, "grandchild.mjs": GRANDCHILD }, ["wrapper.mjs", "grandchild.mjs", "{{pid}}"]);

const stubbornFixture = (name: string) => scaffold(name, { "stubborn.mjs": STUBBORN }, ["stubborn.mjs", "{{pid}}"]);

async function until<T>(fn: () => T | null | false, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error("timed out waiting for the condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const readPid = (file: string) => (existsSync(file) ? Number(readFileSync(file, "utf8").trim()) || null : null);

/** Start a session and hand back the pid it spawned, which is what both kill paths are given. */
function launch(fixture: Fixture, extra: { signal?: AbortSignal; killGraceMs?: number } = {}) {
  let report!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => {
    report = resolve;
  });
  const session = runSession({
    command: process.execPath,
    args: fixture.args,
    cwd: fixture.root,
    env: {},
    transcript: fixture.transcript,
    onSpawn: (spawned) => report(spawned ?? -1),
    ...extra,
  });
  return { session, pid };
}

test("a wrapper's grandchild is killed with the session, not orphaned", async (t) => {
  const fixture = wrapperFixture("wrapper-kill");
  const layout = layoutFor(fixture.root);
  const { session, pid } = launch(fixture);

  const agentPid = await pid;
  const grandchild = await until(() => readPid(fixture.pidFile));
  t.after(() => void terminateSessionTree(grandchild, "SIGKILL"));
  assert.equal(isProcessAlive(grandchild), true, "the grandchild must be running before the kill");

  const pulse: Pulse = {
    pid: process.pid,
    run: "kill-test",
    startedAt: new Date(0).toISOString(),
    milestoneId: "M01",
    attempt: 1,
    sessionStartedAt: new Date(0).toISOString(),
    agentPid,
    transcript: fixture.transcript,
    lastEvent: "session-launched",
    lastEventAt: new Date(0).toISOString(),
  };
  writeFileSync(layout.pulse, JSON.stringify(pulse));

  // The supervisor's own path, end to end: `milestoner kill` against that pulse.
  assert.equal(await kill({ layout, reason: "hung", rule: "rule 4", graceMs: 500 }), 0);

  await session;
  await until(() => !isProcessAlive(grandchild));
  assert.equal(isProcessAlive(grandchild), false, "the grandchild must not survive the kill");
});

test("the runner's abort takes the grandchild with it too", async (t) => {
  const fixture = wrapperFixture("abort-kill");
  const aborter = new AbortController();
  const { session } = launch(fixture, { signal: aborter.signal, killGraceMs: 500 });

  const grandchild = await until(() => readPid(fixture.pidFile));
  t.after(() => void terminateSessionTree(grandchild, "SIGKILL"));
  aborter.abort();

  await session;
  await until(() => !isProcessAlive(grandchild));
  assert.equal(isProcessAlive(grandchild), false, "the second interrupt must reach the whole tree");
});

test("a session that ignores SIGTERM is killed after the grace period", async (t) => {
  const fixture = stubbornFixture("stubborn-kill");
  const { session, pid } = launch(fixture);

  const agentPid = await pid;
  await until(() => readPid(fixture.pidFile));
  t.after(() => void terminateSessionTree(agentPid, "SIGKILL"));

  assert.equal(await killSessionTree(agentPid, 300), true);
  await session;
  await until(() => !isProcessAlive(agentPid));
  assert.equal(isProcessAlive(agentPid), false, "SIGTERM alone would have left it running");
});
