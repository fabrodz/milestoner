import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import type { RunState } from "./types.js";

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
  const root = mkdtempSync(join(tmpdir(), "milestoner-stop-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  for (const id of ["M01", "M02"]) writeFileSync(join(layout.prompts, `${id}.md`), cleanPrompt("stop-test", id));

  const state: RunState = {
    run: "stop-test",
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
  const config = defaultConfig("stop-test", root);
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

test("one interrupt lets the running session finish and be graded, then stops", async () => {
  const { root, layout } = scaffold();
  const stop = new AbortController();
  const killer = new AbortController();
  setTimeout(() => stop.abort(), 300);

  const outcome = await run({ config: configFor(root), layout, signal: killer.signal, stopSignal: stop.signal });
  const state = readState(layout);

  assert.equal(outcome, "stopped");
  assert.equal(state.milestones[0]?.status, "done", "the session that was already running must still be graded");
  assert.deepEqual(state.milestones[0]?.evidence, ["AC1: ran to the end"]);
  assert.equal(state.milestones[1]?.status, "pending", "no further session may be launched");
  assert.equal(state.milestones[1]?.history.length, 0);
});

test("a second interrupt kills the session and leaves the milestone in_progress", async () => {
  const { root, layout } = scaffold();
  const killer = new AbortController();
  setTimeout(() => killer.abort(), 300);

  const outcome = await run({ config: configFor(root), layout, signal: killer.signal });
  const state = readState(layout);

  assert.equal(outcome, "stopped");
  assert.equal(state.milestones[0]?.status, "in_progress", "a killed session gets no verdict");
  assert.equal(state.milestones[0]?.attempts, 0, "and costs no attempt: the next run retries it");
  assert.equal(state.milestones[0]?.history.length, 0);
});
