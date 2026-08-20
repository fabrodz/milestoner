import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { LOCK_FILE, withStateLock } from "./lock.js";
import { loadState, updateState } from "./state.js";
import type { RunState } from "./types.js";

function scaffold(): { dir: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), "milestoner-lock-"));
  const state: RunState = {
    run: "lock-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 0,
    milestones: [
      { id: "M01", title: "M01", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] },
    ],
  };
  const path = join(dir, "state.json");
  writeFileSync(path, JSON.stringify(state));
  return { dir, state: path };
}

test("every write bumps rev, so a reader can tell a change from a change back", () => {
  const { dir, state } = scaffold();

  assert.equal(loadState(state).rev, 0);
  updateState(dir, state, (s) => {
    s.milestones[0]!.attempts = 1;
  });
  assert.equal(loadState(state).rev, 1);

  updateState(dir, state, (s) => {
    s.milestones[0]!.attempts = 0; // back to where it started
  });
  assert.equal(loadState(state).rev, 2, "the value is identical but the run did move");
});

test("the lock is released even when the mutation throws", () => {
  const { dir, state } = scaffold();

  assert.throws(() =>
    updateState(dir, state, () => {
      throw new Error("boom");
    }),
  );

  // A leaked lock would make this hang until the 5s fallback rather than return at once.
  const started = Date.now();
  updateState(dir, state, (s) => {
    s.runComplete = true;
  });
  assert.ok(Date.now() - started < 1000, "the next write must not wait on a leaked lock");
  assert.equal(loadState(state).runComplete, true);
});

test("a lock left by a process that no longer exists is broken, not waited for", () => {
  const { dir, state } = scaffold();
  // pid 1 is alive but not us; a pid that cannot exist is the honest stale case.
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 0x7ffffff0, at: Date.now() }));

  const started = Date.now();
  updateState(dir, state, (s) => {
    s.runComplete = true;
  });

  assert.ok(Date.now() - started < 1000, "a dead holder must not cost the caller its full wait");
  assert.equal(loadState(state).runComplete, true);
});

test("concurrent writers from separate processes do not lose an update", async () => {
  const { dir, state } = scaffold();
  const WRITERS = 6;

  // Each child appends one line. Without the lock, load-mutate-write from six processes loses most
  // of them: whoever renames last wins with a copy that never saw the others.
  const child = join(dir, "writer.mjs");
  // A file URL, not a path: on Windows a bare `D:\...` specifier is read as a URL scheme and rejected.
  const stateModule = pathToFileURL(join(process.cwd(), "src", "state.ts")).href;
  writeFileSync(
    child,
    `import { updateState } from ${JSON.stringify(stateModule)};
     const [dir, state, id] = process.argv.slice(2);
     updateState(dir, state, (s) => { s.milestones[0].evidence.push("writer " + id); });`,
  );

  // Spawned together and awaited together: execFileSync would run them in a queue and prove nothing.
  const codes = await Promise.all(
    Array.from(
      { length: WRITERS },
      (_, i) =>
        new Promise<number | null>((resolve, reject) => {
          const p = spawn(process.execPath, ["--import", "tsx", child, dir, state, String(i)], { stdio: "ignore" });
          p.on("error", reject);
          p.on("close", resolve);
        }),
    ),
  );

  assert.deepEqual([...new Set(codes)], [0], "every writer must exit cleanly");
  const final = loadState(state);
  assert.equal(final.milestones[0]!.evidence.length, WRITERS, "every writer must survive");
  assert.equal(final.rev, WRITERS, "one bump per write, none lost");
});

test("withStateLock returns whatever the critical section returns", () => {
  const { dir } = scaffold();
  assert.equal(
    withStateLock(dir, () => 42),
    42,
  );
});

test("state.json is left parseable, not half-written, after a burst", () => {
  const { dir, state } = scaffold();
  for (let i = 0; i < 25; i += 1) updateState(dir, state, (s) => s.milestones[0]!.evidence.push(`e${i}`));
  const raw = readFileSync(state, "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
  assert.equal(loadState(state).milestones[0]!.evidence.length, 25);
});
