import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { MILESTONER_DIR, layoutFor } from "./paths.js";
import { run, type RunExit } from "./runner.js";
import type { MilestoneStatus, RunState } from "./types.js";

// The runner registers itself in the machine registry; keep these runs out of the real one.
process.env.MILESTONER_HOME = mkdtempSync(join(tmpdir(), "milestoner-home-"));

// A stand-in for the agent: it drops a marker proving a session launched, then writes a done
// verdict. The transcript is large enough that the run is never graded as an infrastructure death.
const AGENT = `
import { writeFileSync } from "node:fs";
const [id, root, dir] = process.argv.slice(2);
console.log("x".repeat(2000));
writeFileSync(root + "/launched.txt", id);
writeFileSync(dir + "/result.json", JSON.stringify({ milestone: id, status: "done", evidence: ["AC1: verified"] }));
`;

const BAD_PROMPT = `# M01 - TODO

## Tasks

1. ...
`;

function goodPrompt(run: string, id: string): string {
  return `# ${id} - Ship the widget

## Objective

A widget that renders, which the run needs before the next milestone can wire it up.

## Acceptance criteria

- **AC1** - the widget renders (evidence: screenshot in \`evidence/${id}.png\`)

## Exit

- Committed and tagged \`${run}-${id}\`.
`;
}

function scaffold(prompts: Record<string, string>, statuses: Record<string, MilestoneStatus> = {}) {
  const root = mkdtempSync(join(tmpdir(), "milestoner-gate-"));
  const layout = layoutFor(root);
  mkdirSync(layout.prompts, { recursive: true });
  writeFileSync(join(root, "agent.mjs"), AGENT);
  for (const [file, text] of Object.entries(prompts)) writeFileSync(join(layout.prompts, file), text);

  const state: RunState = {
    run: "gate-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: Object.keys(prompts).map((file) => {
      const id = file.replace(".md", "");
      return { id, title: id, prompt: file, status: statuses[id] ?? "pending", attempts: 0, evidence: [], history: [] };
    }),
  };
  writeFileSync(layout.state, JSON.stringify(state));

  const config = defaultConfig("gate-test", root);
  config.agent = {
    command: process.execPath,
    args: [join(root, "agent.mjs"), "{{milestoneId}}", root, join(root, MILESTONER_DIR)],
    modelArgs: [],
    model: null,
    env: {},
  };
  config.retryDelaySeconds = 0;
  return { root, layout, config };
}

const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");

async function launch(
  s: ReturnType<typeof scaffold>,
  noLint = false,
): Promise<{ outcome: RunExit; out: string; runLog: string; launched: boolean }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  let outcome: RunExit;
  try {
    outcome = await run({ config: s.config, layout: s.layout, once: true, noLint, signal: new AbortController().signal });
  } finally {
    console.log = log;
    console.error = error;
  }
  return {
    outcome,
    out: plain(lines.join("\n")),
    runLog: existsSync(s.layout.runLog) ? readFileSync(s.layout.runLog, "utf8") : "",
    launched: existsSync(join(s.root, "launched.txt")),
  };
}

test("an error-level finding on a pending milestone refuses the start and launches no session", async () => {
  const s = scaffold({ "M01.md": BAD_PROMPT });
  const { outcome, out, runLog, launched } = await launch(s);

  assert.equal(outcome, "lint-refused");
  assert.equal(launched, false, "no session may launch behind a refusal");
  assert.match(out, /refusing to start/);
  assert.match(out, /template-residue/, "the findings are rendered, not just counted");
  assert.match(out, /milestoner lint/);
  assert.match(out, /--no-lint/);
  assert.match(runLog, / \| - \| lint \| \d+ errors?, \d+ warnings?\n/, "the summary line is written even when refused");

  const state = JSON.parse(readFileSync(s.layout.state, "utf8")) as RunState;
  assert.equal(state.milestones[0]?.status, "pending", "a refused start changes no state");
  assert.equal(state.milestones[0]?.history.length, 0);
});

test("--no-lint starts the same run, and the log line says it was bypassed", async () => {
  const s = scaffold({ "M01.md": BAD_PROMPT });
  const { outcome, runLog, launched } = await launch(s, true);

  assert.equal(outcome, "stopped");
  assert.equal(launched, true, "the session must launch under the bypass");
  assert.match(runLog, / \| - \| lint \| \d+ errors?, \d+ warnings? \(bypassed with --no-lint\)\n/);
});

test("a warnings-only run starts without the flag and still gets its lint line", async () => {
  const s = scaffold({ "M01.md": goodPrompt("gate-test", "M01") });
  const { outcome, runLog, launched } = await launch(s);

  assert.equal(outcome, "stopped");
  assert.equal(launched, true, "warnings never block");
  assert.match(runLog, / \| - \| lint \| 0 errors, [12] warnings?\n/);
});

test("a clean run starts and logs 0 errors, 0 warnings", async () => {
  const s = scaffold({ "M01.md": goodPrompt("gate-test", "M01") });
  writeFileSync(s.layout.protocol, '# Execution protocol - run "gate-test"\n');
  s.config.liveness = ["src"];
  const { outcome, runLog, launched } = await launch(s);

  assert.equal(outcome, "stopped");
  assert.equal(launched, true);
  assert.match(runLog, / \| - \| lint \| 0 errors, 0 warnings\n/);
});

test("errors on a done milestone never stop a resumed run", async () => {
  const s = scaffold(
    { "M01.md": BAD_PROMPT, "M02.md": goodPrompt("gate-test", "M02") },
    { M01: "done" },
  );
  const { outcome, runLog, launched } = await launch(s);

  assert.equal(outcome, "stopped");
  assert.equal(launched, true, "only pending milestones gate the start (D-035)");
  assert.match(runLog, / \| - \| lint \| \d+ errors?, \d+ warnings?\n/);
});
