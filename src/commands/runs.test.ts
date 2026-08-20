import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { layoutFor } from "../paths.js";
import { registerRun } from "../registry.js";
import type { Pulse, RunState } from "../types.js";
import { runs } from "./runs.js";

// Colour depends on whether stdout is a tty, which is not the same when the file is run on its own.
const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");

function capture(fn: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { code: fn(), out: plain(lines.join("\n")) };
  } finally {
    console.log = original;
  }
}

function project(run: string, done: number, total: number, blocked = false): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-runs-"));
  const layout = layoutFor(root);
  mkdirSync(layout.dir, { recursive: true });
  const state: RunState = {
    run,
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: Array.from({ length: total }, (_, i) => ({
      id: `M0${i + 1}`,
      title: `M0${i + 1}`,
      prompt: `M0${i + 1}.md`,
      status: i < done ? "done" : i === done && blocked ? "blocked" : "pending",
      attempts: 0,
      evidence: [],
      history: [],
    })),
  };
  writeFileSync(layout.state, JSON.stringify(state));
  return root;
}

function pulse(root: string, run: string, pid: number, milestoneId: string): void {
  const now = new Date().toISOString();
  const p: Pulse = {
    pid,
    run,
    startedAt: now,
    milestoneId,
    attempt: 2,
    sessionStartedAt: now,
    agentPid: null,
    transcript: null,
    lastEvent: "running 3m",
    lastEventAt: now,
  };
  writeFileSync(layoutFor(root).pulse, JSON.stringify(p));
}

function registry(): string {
  return join(mkdtempSync(join(tmpdir(), "milestoner-home-")), "runs.json");
}

test("both runs are printed with their project, milestone, progress and verdict", () => {
  const file = registry();
  const a = project("checkout-v2", 2, 4);
  const b = project("legacy-tests", 1, 3);
  pulse(a, "checkout-v2", process.pid, "M03");
  registerRun(file, { pid: process.pid, run: "checkout-v2", projectRoot: a, startedAt: new Date().toISOString() });
  registerRun(file, { pid: 0x7ffffff0, run: "legacy-tests", projectRoot: b, startedAt: new Date().toISOString() });

  const { code, out } = capture(() => runs({ registry: file, json: false }));

  assert.match(out, /checkout-v2/);
  assert.match(out, /legacy-tests/);
  assert.ok(out.includes(a) && out.includes(b), "the project path is what makes an entry actionable");
  assert.match(out, /alive.+checkout-v2\s+M03\s+2\/4/);
  assert.match(out, /gone.+legacy-tests\s+M02\s+1\/3/);
  assert.equal(code, 2, "a runner that is gone needs a human, and the exit code says so");
});

test("a blocked run exits 2, the same signal `status` gives", () => {
  const file = registry();
  const root = project("stuck", 1, 3, true);
  pulse(root, "stuck", process.pid, "M02");
  registerRun(file, { pid: process.pid, run: "stuck", projectRoot: root, startedAt: new Date().toISOString() });

  const { code, out } = capture(() => runs({ registry: file, json: false }));
  assert.match(out, /1 blocked/);
  assert.equal(code, 2);
});

test("a deleted project is reported as pruned and does not take the listing down with it", () => {
  const file = registry();
  const alive = project("still-here", 1, 2);
  pulse(alive, "still-here", process.pid, "M02");
  const doomed = project("deleted-run", 0, 2);
  registerRun(file, { pid: process.pid, run: "still-here", projectRoot: alive, startedAt: new Date().toISOString() });
  registerRun(file, { pid: process.pid, run: "deleted-run", projectRoot: doomed, startedAt: new Date().toISOString() });
  rmSync(doomed, { recursive: true, force: true });

  const { code, out } = capture(() => runs({ registry: file, json: false }));

  assert.match(out, /pruned deleted-run/);
  assert.match(out, /still-here/);
  assert.equal(code, 0);
});

test("--json is the same listing, machine-readable", () => {
  const file = registry();
  const root = project("json-run", 0, 2);
  pulse(root, "json-run", process.pid, "M01");
  registerRun(file, { pid: process.pid, run: "json-run", projectRoot: root, startedAt: new Date().toISOString() });

  const { out } = capture(() => runs({ registry: file, json: true }));
  const parsed = JSON.parse(out) as { registry: string; runs: { run: string; health: string; projectRoot: string }[] };

  assert.equal(parsed.registry, file);
  assert.equal(parsed.runs[0]?.run, "json-run");
  assert.equal(parsed.runs[0]?.health, "alive");
  assert.equal(parsed.runs[0]?.projectRoot, root);
});

test("an empty registry says so and exits 0", () => {
  const { code, out } = capture(() => runs({ registry: registry(), json: false }));
  assert.match(out, /no runs registered on this machine/);
  assert.equal(code, 0);
});
