import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import type { AgentConfig, RunState } from "./types.js";

// The runner registers itself in the machine registry; keep these runs out of the real one.
process.env.MILESTONER_HOME = mkdtempSync(join(tmpdir(), "milestoner-home-"));

// Records the argv it was launched with, then reports done. The transcript is deliberately large
// enough that the session is never graded as an infrastructure death.
const RECORDER = `
import { writeFileSync } from "node:fs";
const [marker, id, dir] = process.argv.slice(2);
console.log("x".repeat(2000));
writeFileSync(marker, JSON.stringify(process.argv.slice(2)));
writeFileSync(dir + "/result.json", JSON.stringify({ milestone: id, status: "done", evidence: ["AC1: verified"] }));
`;

// Writes nothing at all: no transcript and no result.json is an instant-death, which benches this
// agent and rotates the run onto the fallback.
const DIES = "process.exit(0);\n";

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

function scaffold(models: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "milestoner-model-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "recorder.mjs"), RECORDER);
  writeFileSync(join(root, "dies.mjs"), DIES);

  const ids = ["M01", "M02"];
  for (const id of ids) writeFileSync(join(layout.prompts, `${id}.md`), cleanPrompt("model-test", id));

  const state: RunState = {
    run: "model-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: ids.map((id) => ({
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

  const config = defaultConfig("model-test", root);
  config.agent = recorder(root, "sonnet");
  config.models = models;
  config.retryDelaySeconds = 0;
  return { root, layout, config };
}

// {{milestoneId}} is substituted in every argument, so each milestone lands in its own marker file.
function recorder(root: string, model: string | null): AgentConfig {
  return {
    command: process.execPath,
    args: [
      join(root, "recorder.mjs"),
      join(root, "{{milestoneId}}-argv.json"),
      "{{milestoneId}}",
      join(root, MILESTONER_DIR),
    ],
    modelArgs: ["--model", "{{model}}"],
    model,
    env: {},
  };
}

function argvOf(root: string, id: string): string[] {
  return JSON.parse(readFileSync(join(root, `${id}-argv.json`), "utf8")) as string[];
}

test("a per-milestone model reaches the session, and a milestone the map omits keeps the agent's own", async () => {
  const { root, layout, config } = scaffold({ M02: "opus" });
  const signal = new AbortController().signal;

  await run({ config, layout, once: true, milestoneId: "M01", signal });
  await run({ config, layout, once: true, milestoneId: "M02", signal });

  assert.deepEqual(argvOf(root, "M01").slice(-2), ["--model", "sonnet"]);
  assert.deepEqual(argvOf(root, "M02").slice(-2), ["--model", "opus"]);
});

test("a run-level model override beats the per-milestone entry", async () => {
  const { root, layout, config } = scaffold({ M01: "opus", M02: "opus" });
  const signal = new AbortController().signal;

  await run({ config, layout, once: true, milestoneId: "M01", model: "haiku", signal });

  assert.deepEqual(argvOf(root, "M01").slice(-2), ["--model", "haiku"]);
});

test("a fallback agent keeps its own model whatever the map says", async () => {
  const { root, layout, config } = scaffold({ M01: "opus" });
  config.agent = { ...recorder(root, "sonnet"), args: [join(root, "dies.mjs")] };
  config.fallbackAgents = [{ ...recorder(root, "gpt-5-codex"), name: "codex" }];

  await run({ config, layout, once: true, milestoneId: "M01", signal: new AbortController().signal });

  const argv = argvOf(root, "M01");
  assert.deepEqual(argv.slice(-2), ["--model", "gpt-5-codex"]);
  assert.equal(argv.includes("opus"), false, "the map belongs to the primary agent only");
});
