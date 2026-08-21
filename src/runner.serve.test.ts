import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import { panelInfoPath } from "./server/global.js";
import { createPanel } from "./server/http.js";
import type { RunState } from "./types.js";
import { writeJsonAtomic } from "./util/fs.js";

// The runner registers itself in the machine registry; keep these runs out of the real one.
process.env.MILESTONER_HOME = mkdtempSync(join(tmpdir(), "milestoner-home-"));

const AGENT = `
import { writeFileSync } from "node:fs";
const [id, dir] = process.argv.slice(2);
console.log("working on", id);
setTimeout(() => {
  writeFileSync(dir + "/result.json", JSON.stringify({ milestone: id, status: "done", evidence: ["AC1: ran to the end"] }));
}, 1200);
`;

// Colour depends on whether stdout is a tty, which is not the same when the file is run on its own.
const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A prompt the lint gate has no reason to refuse: the gate runs on every start, fixtures included.
function cleanPrompt(run: string, id: string): string {
  return [
    `# ${id}`,
    "## Objective",
    "A fixture milestone that exists so the runner has something to execute.",
    "## Acceptance criteria",
    "- **AC1** - the fake agent ran (evidence: result.json)",
    "## Exit",
    `- Tagged ${run}-${id}.`,
  ].join("\n\n");
}

function scaffold(): { root: string; layout: ReturnType<typeof layoutFor> } {
  const root = mkdtempSync(join(tmpdir(), "milestoner-serve-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  for (const id of ["M01", "M02"]) writeFileSync(join(layout.prompts, `${id}.md`), cleanPrompt("serve-test", id));

  const state: RunState = {
    run: "serve-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: ["M01", "M02"].map((id) => ({
      id,
      title: id,
      prompt: `${id}.md`,
      status: "pending" as const,
      attempts: 0,
      evidence: [],
      history: [],
    })),
  };
  writeFileSync(layout.state, JSON.stringify(state));
  return { root, layout };
}

function configFor(root: string) {
  const config = defaultConfig("serve-test", root);
  config.agent = {
    command: process.execPath,
    args: [join(root, "agent.mjs"), "{{milestoneId}}", join(root, MILESTONER_DIR)],
    modelArgs: [],
    model: null,
    env: {},
  };
  config.retryDelaySeconds = 0;
  return config;
}

function readState(layout: ReturnType<typeof layoutFor>): RunState {
  return JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(plain(args.map(String).join(" ")));
  return { lines, restore: () => void (console.log = original) };
}

async function waitForUrl(lines: string[]): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const found = lines.join("\n").match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/);
    if (found) return found[0];
    await sleep(25);
  }
  throw new Error("the panel never printed a URL");
}

type StateView = Record<string, unknown> & { pulse: Record<string, unknown> | null };

/** Poll the live panel until it reports what we are asserting about, or give up loudly. */
async function stateFrom(url: string, ready: (d: StateView) => boolean): Promise<StateView> {
  const api = url.replace("/?token=", "/api/state?token=");
  let last: StateView | null = null;
  for (let i = 0; i < 200; i += 1) {
    const res = await fetch(api);
    last = (await res.json()) as StateView;
    if (res.status === 200 && ready(last)) return last;
    await sleep(25);
  }
  throw new Error(`the panel never reported a live run: ${JSON.stringify(last).slice(0, 300)}`);
}

function busyPort(): Promise<{ port: number; close: () => void }> {
  const squatter = createServer((_req, res) => res.end("busy"));
  return new Promise((resolve) => {
    squatter.listen(0, "127.0.0.1", () =>
      resolve({ port: (squatter.address() as AddressInfo).port, close: () => squatter.close() }),
    );
  });
}

function canBind(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

test("the panel comes up with the run and answers with this run's live state", async () => {
  const { root, layout } = scaffold();
  const cap = captureLog();
  const running = run({
    config: configFor(root),
    layout,
    signal: new AbortController().signal,
    once: true,
    serve: { port: 0, write: false },
  });

  try {
    const url = await waitForUrl(cap.lines);
    const view = await stateFrom(url, (d) => d.pulse?.runnerAlive === true);
    assert.equal(view.run, "serve-test");
    assert.equal(view.pulse?.pid, process.pid, "the panel answers for the runner that started it");
    assert.equal(view.pulse?.milestoneId, "M01", "and for the milestone that run is on right now");
  } finally {
    await running;
    cap.restore();
  }

  assert.equal(readState(layout).milestones[0]?.status, "done", "the run drained normally meanwhile");
});

test("the panel is closed once the run ends, and its port is free again", async () => {
  const { root, layout } = scaffold();
  const cap = captureLog();
  const running = run({
    config: configFor(root),
    layout,
    signal: new AbortController().signal,
    once: true,
    serve: { port: 0, write: false },
  });

  const url = await waitForUrl(cap.lines);
  const port = Number(new URL(url).port);
  await running;
  cap.restore();

  await assert.rejects(fetch(url), "the panel must not answer once the run has ended");
  assert.equal(await canBind(port), true, "the port must be free, not held by a stream nobody closed");
  assert.equal(readState(layout).milestones[0]?.status, "done");
});

test("a port already in use moves the panel and does not take the run down", async () => {
  const { root, layout } = scaffold();
  const taken = await busyPort();
  const cap = captureLog();
  const running = run({
    config: configFor(root),
    layout,
    signal: new AbortController().signal,
    once: true,
    serve: { port: taken.port, write: false },
  });

  try {
    const url = await waitForUrl(cap.lines);
    assert.notEqual(Number(new URL(url).port), taken.port, "the panel must not claim the busy port");
    assert.ok(
      cap.lines.some((l) => l.includes(`port ${taken.port} is already in use - the panel is on port `)),
      `the user must be told what happened, got: ${cap.lines.join(" / ")}`,
    );
    const view = await stateFrom(url, (d) => d.pulse?.runnerAlive === true);
    assert.equal(view.run, "serve-test", "and the panel that did come up answers for this run");
  } finally {
    await running;
    cap.restore();
    taken.close();
  }

  assert.equal(readState(layout).milestones[0]?.status, "done", "the run drained normally");
});

test("one interrupt with a panel attached still finishes and grades the running session", async () => {
  const { root, layout } = scaffold();
  const stop = new AbortController();
  const killer = new AbortController();
  const cap = captureLog();
  setTimeout(() => stop.abort(), 300);

  const running = run({
    config: configFor(root),
    layout,
    signal: killer.signal,
    stopSignal: stop.signal,
    serve: { port: 0, write: false },
  });
  const url = await waitForUrl(cap.lines);
  const outcome = await running;
  cap.restore();
  const state = readState(layout);

  assert.equal(outcome, "stopped");
  assert.equal(state.milestones[0]?.status, "done", "the session that was already running must still be graded");
  assert.deepEqual(state.milestones[0]?.evidence, ["AC1: ran to the end"]);
  assert.equal(state.milestones[1]?.status, "pending", "no further session may be launched");
  await assert.rejects(fetch(url), "and the panel closed with the run");
});

test("a run that joins a live machine panel prints its URL instead of starting another", async () => {
  const { root, layout } = scaffold();
  const registry = join(process.env.MILESTONER_HOME!, "runs.json");
  const machine = createPanel({ scope: { kind: "machine", registry, cliPath: "" }, port: 0, token: "machine-key", allowWrites: true });
  await new Promise<void>((r) => machine.listen(0, "127.0.0.1", r));
  const port = (machine.address() as AddressInfo).port;
  writeJsonAtomic(panelInfoPath(), { pid: process.pid, port, token: "machine-key", startedAt: new Date().toISOString() });

  const cap = captureLog();
  try {
    await run({
      config: configFor(root),
      layout,
      signal: new AbortController().signal,
      once: true,
      globalPanel: { cliPath: "", port: 4400, write: true, open: "never" },
    });
  } finally {
    cap.restore();
    machine.close();
    machine.closeAllConnections();
  }

  assert.ok(
    cap.lines.some((l) => l.includes(`http://127.0.0.1:${port}/?token=machine-key`)),
    `every run must remind where the machine panel is, got: ${cap.lines.join(" / ")}`,
  );
  assert.ok(
    !cap.lines.some((l) => l.includes("machine panel, stays up")),
    "joining is not spawning: the run found the panel already there",
  );
});

test("a second interrupt with a panel attached still leaves the milestone in_progress", async () => {
  const { root, layout } = scaffold();
  const killer = new AbortController();
  const cap = captureLog();
  setTimeout(() => killer.abort(), 300);

  const running = run({ config: configFor(root), layout, signal: killer.signal, serve: { port: 0, write: false } });
  const url = await waitForUrl(cap.lines);
  const outcome = await running;
  cap.restore();
  const state = readState(layout);

  assert.equal(outcome, "stopped");
  assert.equal(state.milestones[0]?.status, "in_progress", "a killed session gets no verdict");
  assert.equal(state.milestones[0]?.attempts, 0, "and costs no attempt: the next run retries it");
  assert.equal(state.milestones[0]?.history.length, 0);
  await assert.rejects(fetch(url), "and the panel closed with the run");
});
