import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor, registryPath } from "./paths.js";
import { listRuns } from "./registry.js";
import { run } from "./runner.js";
import type { RunState } from "./types.js";

const home = mkdtempSync(join(tmpdir(), "milestoner-home-"));
process.env.MILESTONER_HOME = home;

// Copies the registry as the session sees it, which is the only moment the entry is supposed to
// exist. The transcript is padded so the run is never graded as an infrastructure death.
const AGENT = `
import { copyFileSync, writeFileSync } from "node:fs";
const [id, dir, registry, snapshot] = process.argv.slice(2);
console.log("x".repeat(2000));
copyFileSync(registry, snapshot);
writeFileSync(dir + "/result.json", JSON.stringify({ milestone: id, status: "done", evidence: ["AC1: ran"] }));
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

test("the runner registers while it runs and deregisters in the same finally that clears the pulse", async () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-reg-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  writeFileSync(join(layout.prompts, "M01.md"), cleanPrompt("registry-test", "M01"));

  const state: RunState = {
    run: "registry-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: [{ id: "M01", title: "M01", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] }],
  };
  writeFileSync(layout.state, JSON.stringify(state));

  const snapshot = join(root, "registry-during-session.json");
  const config = defaultConfig("registry-test", root);
  config.agent = {
    command: process.execPath,
    args: [join(root, "agent.mjs"), "{{milestoneId}}", join(root, MILESTONER_DIR), registryPath(), snapshot],
    modelArgs: [],
    model: null,
    env: {},
  };
  config.retryDelaySeconds = 0;

  await run({ config, layout, once: true, signal: new AbortController().signal });

  const during = JSON.parse(readFileSync(snapshot, "utf8")) as { runs: { run: string; projectRoot: string; pid: number }[] };
  const entry = during.runs.find((r) => r.run === "registry-test");
  assert.ok(entry, "the run must be findable from another directory while it is running");
  assert.equal(entry.projectRoot, root);
  assert.equal(entry.pid, process.pid, "the registered pid is the runner's, not the agent session's");

  assert.deepEqual(listRuns(registryPath()).runs, [], "a runner that ended must leave no entry behind");
  assert.equal(JSON.parse(readFileSync(layout.state, "utf8")).milestones[0].status, "done");
});
