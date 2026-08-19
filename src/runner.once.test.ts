import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { DOGWATCH_DIR, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import type { RunState } from "./types.js";

// A stand-in for the agent: it writes whatever verdict the test put in verdict.json. The transcript
// is deliberately large enough that the run is never graded as an infrastructure death.
const AGENT = `
import { readFileSync, writeFileSync } from "node:fs";
const [id, dir, verdictFile] = process.argv.slice(2);
console.log("x".repeat(2000));
writeFileSync(dir + "/result.json", readFileSync(verdictFile, "utf8").replace("__ID__", id));
`;

function scaffold(verdict: unknown) {
  const root = mkdtempSync(join(tmpdir(), "dogwatch-once-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  writeFileSync(join(root, "verdict.json"), JSON.stringify(verdict));
  writeFileSync(join(layout.prompts, "M01.md"), "# M01");

  const state: RunState = {
    run: "once-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: [
      { id: "M01", title: "M01", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] },
    ],
  };
  writeFileSync(layout.state, JSON.stringify(state));

  const config = defaultConfig("once-test", root);
  config.agent = {
    command: process.execPath,
    args: [join(root, "agent.mjs"), "{{milestoneId}}", join(root, DOGWATCH_DIR), join(root, "verdict.json")],
    modelArgs: [],
    model: null,
    env: {},
  };
  config.retryDelaySeconds = 0;
  return { root, layout, config };
}

test("--once reports a block, so a script cannot read exit 0 over a blocked run", async () => {
  const { layout, config } = scaffold({
    milestone: "__ID__",
    status: "blocked",
    diagnosis: { symptom: "port 5173 busy", tried: ["restart"], userAction: "free port 5173" },
  });

  const outcome = await run({ config, layout, once: true, signal: new AbortController().signal });

  assert.equal(outcome, "blocked");
  const state = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
  assert.equal(state.milestones[0]?.status, "blocked");
});

test("--once on a session that succeeds still just stops", async () => {
  const { layout, config } = scaffold({ milestone: "__ID__", status: "done", evidence: ["AC1: verified"] });

  const outcome = await run({ config, layout, once: true, signal: new AbortController().signal });

  assert.equal(outcome, "stopped");
});

test("a milestone that recovers does not keep the diagnosis of the attempt that failed", async () => {
  const { root, layout, config } = scaffold({
    milestone: "__ID__",
    status: "blocked",
    diagnosis: { symptom: "port 5173 busy", tried: ["restart"], userAction: "free port 5173" },
  });

  await run({ config, layout, once: true, signal: new AbortController().signal });
  const blocked = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
  assert.equal(blocked.milestones[0]?.diagnosis?.symptom, "port 5173 busy", "the block must be recorded first");

  // The user clears the block, the next session succeeds.
  blocked.milestones[0]!.status = "pending";
  writeFileSync(layout.state, JSON.stringify(blocked));
  writeFileSync(join(root, "verdict.json"), JSON.stringify({ milestone: "__ID__", status: "done", evidence: ["AC1: verified"] }));

  await run({ config, layout, once: true, signal: new AbortController().signal });
  const done = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;

  assert.equal(done.milestones[0]?.status, "done");
  assert.equal(done.milestones[0]?.diagnosis, null, "a stale diagnosis would be reported as a live block");
});
