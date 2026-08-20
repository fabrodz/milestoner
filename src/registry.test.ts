import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { layoutFor } from "./paths.js";
import { RETENTION_MS, deregisterRun, listRuns, registerRun } from "./registry.js";
import type { Pulse, RunState } from "./types.js";

function machine(): string {
  return join(mkdtempSync(join(tmpdir(), "milestoner-registry-")), "runs.json");
}

/** A project on disk: a state.json the listing can read, and optionally the pulse of a live runner. */
function project(run: string, done: number, total: number, opts: { blocked?: boolean; complete?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-project-"));
  const layout = layoutFor(root);
  mkdirSync(layout.dir, { recursive: true });
  const state: RunState = {
    run,
    createdAt: new Date(0).toISOString(),
    runComplete: opts.complete ?? false,
    rev: 0,
    milestones: Array.from({ length: total }, (_, i) => ({
      id: `M0${i + 1}`,
      title: `M0${i + 1}`,
      prompt: `M0${i + 1}.md`,
      status: i < done ? "done" : i === done && opts.blocked ? "blocked" : "pending",
      attempts: 0,
      evidence: [],
      history: [],
    })),
  };
  writeFileSync(layout.state, JSON.stringify(state));
  return root;
}

function pulse(root: string, run: string, pid: number, milestoneId: string, lastEventAt = new Date().toISOString()): void {
  const p: Pulse = {
    pid,
    run,
    startedAt: lastEventAt,
    milestoneId,
    attempt: 1,
    sessionStartedAt: lastEventAt,
    agentPid: null,
    transcript: null,
    lastEvent: "running 1m",
    lastEventAt,
  };
  writeFileSync(layoutFor(root).pulse, JSON.stringify(p));
}

test("two runs in different directories are both listed, each with its own milestone and verdict", () => {
  const file = machine();
  const a = project("checkout-v2", 2, 4);
  const b = project("legacy-tests", 1, 3);
  pulse(a, "checkout-v2", process.pid, "M03");
  pulse(b, "legacy-tests", process.pid, "M02", new Date(Date.now() - 30 * 60 * 1000).toISOString());

  registerRun(file, { pid: process.pid, run: "checkout-v2", projectRoot: a, startedAt: new Date().toISOString() });
  registerRun(file, { pid: process.pid, run: "legacy-tests", projectRoot: b, startedAt: new Date().toISOString() });

  const listing = listRuns(file);
  assert.equal(listing.runs.length, 2, "both directories must appear, whichever one you asked from");

  const first = listing.runs.find((r) => r.run === "checkout-v2");
  assert.equal(first?.milestoneId, "M03", "the milestone comes from that project's own pulse");
  assert.deepEqual([first?.done, first?.total], [2, 4]);
  assert.equal(first?.health, "alive");

  const second = listing.runs.find((r) => r.run === "legacy-tests");
  assert.equal(second?.milestoneId, "M02");
  assert.equal(second?.health, "hung", "a runner that has not logged an event in 30m is not alive");
});

test("a runner that is gone leaves no live entry, and expires out of the file a day later", () => {
  const file = machine();
  const root = project("killed-run", 1, 3);
  // A killed runner never reaches its `finally`, so the pulse it wrote is still there.
  const deadPid = 0x7ffffff0;
  pulse(root, "killed-run", deadPid, "M02");
  registerRun(file, { pid: deadPid, run: "killed-run", projectRoot: root, startedAt: new Date().toISOString() });

  const listing = listRuns(file);
  assert.equal(listing.runs.length, 1, "the dead run is the one a person most wants to be told about");
  assert.equal(listing.runs[0]?.runnerAlive, false);
  assert.equal(listing.runs[0]?.health, "gone");
  assert.equal(listing.runs[0]?.milestoneId, "M02", "still reported, from state.json rather than the stale pulse");

  const later = listRuns(file, Date.now() + RETENTION_MS + 1000);
  assert.deepEqual(later.runs, [], "past the retention window it stops being news");
  assert.equal(later.pruned[0]?.reason, "expired");
  assert.deepEqual(listRuns(file).runs, [], "and it is gone from the file, not recomputed every read");
});

test("a recycled pid is not mistaken for a live run", () => {
  const file = machine();

  // This process is alive and its pid is real, but it is not the runner for either project.
  const exited = project("clean-exit", 3, 3);
  registerRun(file, { pid: process.pid, run: "clean-exit", projectRoot: exited, startedAt: new Date().toISOString() });

  const other = project("other-run", 0, 2);
  pulse(other, "a-different-run", process.pid, "M01");
  registerRun(file, { pid: process.pid, run: "other-run", projectRoot: other, startedAt: new Date().toISOString() });

  const byRun = new Map(listRuns(file).runs.map((r) => [r.run, r]));
  assert.equal(byRun.get("clean-exit")?.runnerAlive, false, "no pulse in the project: the runner exited and the pid was reused");
  assert.equal(byRun.get("other-run")?.runnerAlive, false, "a pulse naming a different run does not corroborate this entry");
});

test("a registered project whose directory is gone is pruned and reported, not fatal", () => {
  const file = machine();
  const alive = project("still-here", 1, 2);
  pulse(alive, "still-here", process.pid, "M02");
  const doomed = project("deleted-run", 0, 2);

  registerRun(file, { pid: process.pid, run: "still-here", projectRoot: alive, startedAt: new Date().toISOString() });
  registerRun(file, { pid: process.pid, run: "deleted-run", projectRoot: doomed, startedAt: new Date().toISOString() });
  rmSync(doomed, { recursive: true, force: true });

  const listing = listRuns(file);
  assert.deepEqual(
    listing.runs.map((r) => r.run),
    ["still-here"],
    "one unreachable project must not cost the listing every other run",
  );
  assert.equal(listing.pruned.length, 1);
  assert.equal(listing.pruned[0]?.run, "deleted-run");
  assert.equal(listing.pruned[0]?.reason, "project-gone");
  assert.equal(listRuns(file).pruned.length, 0, "reported once, then dropped from the file");
});

test("concurrent registration from several processes loses no entry", async () => {
  const file = machine();
  const RUNNERS = 6;
  const roots = Array.from({ length: RUNNERS }, (_, i) => project(`run-${i}`, 0, 1));

  // Same argument as D-022: without the lock, six load-mutate-write cycles leave whoever renamed
  // last holding a copy that never saw the other five.
  const child = join(mkdtempSync(join(tmpdir(), "milestoner-registry-child-")), "register.mjs");
  // A file URL, not a path: on Windows a bare `D:\...` specifier is read as a URL scheme.
  const registryModule = pathToFileURL(join(process.cwd(), "src", "registry.ts")).href;
  writeFileSync(
    child,
    `import { registerRun } from ${JSON.stringify(registryModule)};
     const [file, root, i] = process.argv.slice(2);
     registerRun(file, { pid: process.pid, run: "run-" + i, projectRoot: root, startedAt: new Date().toISOString() });`,
  );

  const codes = await Promise.all(
    roots.map(
      (root, i) =>
        new Promise<number | null>((resolve, reject) => {
          const p = spawn(process.execPath, ["--import", "tsx", child, file, root, String(i)], { stdio: "ignore" });
          p.on("error", reject);
          p.on("close", resolve);
        }),
    ),
  );

  assert.deepEqual([...new Set(codes)], [0], "every runner must register cleanly");
  const listed = listRuns(file).runs.map((r) => r.run).sort();
  assert.deepEqual(listed, roots.map((_, i) => `run-${i}`).sort(), "every registration must survive");
});

test("registering the same directory twice replaces the entry, because one run per directory is the rule", () => {
  const file = machine();
  const root = project("relaunched", 1, 2);

  registerRun(file, { pid: 4242, run: "relaunched", projectRoot: root, startedAt: new Date().toISOString() });
  registerRun(file, { pid: 4343, run: "relaunched", projectRoot: root, startedAt: new Date().toISOString() });

  const listing = listRuns(file);
  assert.equal(listing.runs.length, 1, "a relaunch must not list the directory twice");
  assert.equal(listing.runs[0]?.pid, 4343);
});

test("deregistering removes that runner's entry and leaves the others alone", () => {
  const file = machine();
  const a = project("leaving", 1, 2);
  const b = project("staying", 0, 2);
  registerRun(file, { pid: 4242, run: "leaving", projectRoot: a, startedAt: new Date().toISOString() });
  registerRun(file, { pid: 4343, run: "staying", projectRoot: b, startedAt: new Date().toISOString() });

  deregisterRun(file, a, 4242);

  assert.deepEqual(
    listRuns(file).runs.map((r) => r.run),
    ["staying"],
  );
});

test("a run that finished reads as complete rather than as a runner that vanished", () => {
  const file = machine();
  const root = project("finished", 3, 3, { complete: true });
  registerRun(file, { pid: 0x7ffffff0, run: "finished", projectRoot: root, startedAt: new Date().toISOString() });

  assert.equal(listRuns(file).runs[0]?.health, "complete");
});

test("an unreadable or absent registry lists nothing instead of throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "milestoner-registry-"));
  assert.deepEqual(listRuns(join(dir, "never-written.json")).runs, []);

  const corrupt = join(dir, "runs.json");
  writeFileSync(corrupt, "{ not json");
  assert.deepEqual(listRuns(corrupt).runs, []);
});
