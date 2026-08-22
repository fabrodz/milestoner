import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { loadConfig } from "./config.js";
import { layoutFor } from "./paths.js";
import { appendSupervisorLog, readInterventions, SUPERVISOR_LOG_HEADER } from "./supervisorLog.js";

function capture<T>(fn: () => T): { value: T; printed: string } {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { value: fn(), printed: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function scaffold(): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-supervisorlog-"));
  capture(() => init({ projectRoot: root, run: "sup-fixture", count: 2, force: false }));
  return layoutFor(root);
}

test("a log that only carries its own header holds no interventions", () => {
  const layout = scaffold();

  assert.deepEqual(readInterventions(layout.supervisorLog, 20), [], "the title and the format line are scaffold, not actions");
  assert.deepEqual(readInterventions(join(layout.dir, "never-written.md"), 20), [], "a missing file reads as none");
});

test("the header stays filtered once real interventions arrive, and the tail is the newest", () => {
  const layout = scaffold();
  appendSupervisorLog(layout, "3", "ran the environment adapter", "exit 0");
  appendSupervisorLog(layout, "4", "killed the session", "attempt charged");

  const lines = readInterventions(layout.supervisorLog, 20);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => !SUPERVISOR_LOG_HEADER.includes(l)), "no header line survives");
  assert.match(lines[0]!, / \| 3 \| ran the environment adapter \| exit 0$/);
  assert.match(lines[1]!, / \| 4 \| killed the session \| attempt charged$/);

  assert.deepEqual(readInterventions(layout.supervisorLog, 1), [lines[1]], "the tail keeps the newest");
});

test("status --json reports no interventions on a run nobody has intervened in", () => {
  const layout = scaffold();
  const config = loadConfig(layout.config, layout.projectRoot);

  const first = capture(() => status({ config, layout, json: true }));
  assert.deepEqual(JSON.parse(first.printed).recentInterventions, [], "the log's header is never served as an intervention");

  appendSupervisorLog(layout, "4", "killed the session", "attempt charged");
  const second = capture(() => status({ config, layout, json: true }));
  const reported = JSON.parse(second.printed).recentInterventions as string[];
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /killed the session \| attempt charged$/);
});

test("a hand-written log with no header is read exactly as it is", () => {
  const layout = scaffold();
  writeFileSync(layout.supervisorLog, "2026-08-22T20:00:00.000Z | 1 | held | nothing to do\n");

  assert.deepEqual(readInterventions(layout.supervisorLog, 20), ["2026-08-22T20:00:00.000Z | 1 | held | nothing to do"]);
});
