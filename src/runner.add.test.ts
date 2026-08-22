import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendMilestone } from "./add.js";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import type { RunState } from "./types.js";

process.env.MILESTONER_HOME = mkdtempSync(join(tmpdir(), "milestoner-home-"));

// The fake agent blocks until the go file exists, so the test can append a milestone while the
// session is provably alive. The transcript is large enough to never read as an infra death.
const AGENT = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [id, dir, verdictFile, goFile] = process.argv.slice(2);
console.log("x".repeat(2000));
while (!existsSync(goFile)) await new Promise((r) => setTimeout(r, 25));
writeFileSync(dir + "/result.json", readFileSync(verdictFile, "utf8").replace("__ID__", id));
`;

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

test("a milestone appended while the runner is alive is picked up on the next loop pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-add-live-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  writeFileSync(join(root, "verdict.json"), JSON.stringify({ milestone: "__ID__", status: "done", evidence: ["AC1: verified"] }));
  writeFileSync(join(layout.prompts, "M01.md"), cleanPrompt("add-live", "M01"));

  const state: RunState = {
    run: "add-live",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: [{ id: "M01", title: "M01", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] }],
  };
  writeFileSync(layout.state, JSON.stringify(state));

  const goFile = join(root, "go.txt");
  const config = defaultConfig("add-live", root);
  config.agent = {
    command: process.execPath,
    args: [join(root, "agent.mjs"), "{{milestoneId}}", join(root, MILESTONER_DIR), join(root, "verdict.json"), goFile],
    modelArgs: [],
    model: null,
    env: {},
  };
  config.retryDelaySeconds = 0;

  const running = run({ config, layout, signal: new AbortController().signal });

  // The pulse appears when the first session launches; only then is "while a runner is alive" true.
  const deadline = Date.now() + 10_000;
  while (!existsSync(layout.pulse)) {
    assert.ok(Date.now() < deadline, "the first session never launched");
    await new Promise((r) => setTimeout(r, 25));
  }

  const added = appendMilestone(layout, "appended mid-run");
  assert.equal(added.id, "M02");
  writeFileSync(join(layout.prompts, "M02.md"), cleanPrompt("add-live", "M02"));
  writeFileSync(goFile, "go");

  const outcome = await running;
  assert.equal(outcome, "complete", "the runner drained the appended milestone rather than stopping after M01");

  const after = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
  assert.equal(after.runComplete, true);
  assert.equal(after.milestones.length, 2);
  assert.equal(after.milestones[1]?.id, "M02");
  assert.equal(after.milestones[1]?.status, "done");
  assert.equal(after.milestones[1]?.history.length, 1, "the appended milestone got its own session");
});
