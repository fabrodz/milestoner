import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendMilestone } from "./add.js";
import { init } from "./commands/init.js";
import { layoutFor } from "./paths.js";
import { loadState, nextMilestone } from "./state.js";
import type { RunState } from "./types.js";

function capture<T>(fn: () => T): T {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

function scaffold(run: string, count = 2): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-add-"));
  const scaffolded = capture(() => init({ projectRoot: root, run, count, force: false }));
  assert.equal(scaffolded.code, 0, "the scaffold must succeed");
  return layoutFor(root);
}

test("append gives the next id, a pending entry and the skeleton, and bumps the rev", () => {
  const layout = scaffold("add-basic");
  const before = loadState(layout.state);

  const added = appendMilestone(layout);
  assert.equal(added.id, "M03");
  assert.equal(added.promptFile, "M03.md");
  assert.equal(added.promptCreated, true);
  assert.equal(added.runResumed, false);

  const state = loadState(layout.state);
  assert.equal(state.rev, before.rev + 1, "the write went through the locked save, which bumps the rev");
  const m = state.milestones.at(-1);
  assert.equal(m?.id, "M03");
  assert.equal(m?.status, "pending");
  assert.equal(m?.attempts, 0);
  assert.equal(m?.prompt, "M03.md");
  assert.deepEqual(m?.evidence, []);
  assert.deepEqual(m?.history, []);
  assert.match(m?.title ?? "", /^TODO: milestone 3 title$/, "the default title is init's placeholder, so the linter treats both the same");

  const skeleton = readFileSync(added.promptPath, "utf8");
  assert.match(skeleton, /^# M03 - TODO: milestone 3 title/, "the skeleton names the milestone");
  assert.match(skeleton, /add-basic-M03/, "and the run's tag convention");

  const again = appendMilestone(layout, "a written title");
  assert.equal(again.id, "M04", "ids stay sequential across appends");
  assert.equal(loadState(layout.state).milestones.at(-1)?.title, "a written title");
});

test("an existing prompt file with the skeleton's name is kept byte for byte", () => {
  const layout = scaffold("add-keeps");
  const written = "# M03 - written before the slot existed\n\n## Objective\n\nAlready authored.\n";
  writeFileSync(join(layout.prompts, "M03.md"), written);

  const added = appendMilestone(layout, "the authored one");
  assert.equal(added.id, "M03");
  assert.equal(added.promptCreated, false, "the append reports it kept the file");
  assert.equal(readFileSync(added.promptPath, "utf8"), written, "the authored prompt survives the append untouched");
});

test("a completed run that gains a milestone is a run again", () => {
  const layout = scaffold("add-complete", 1);
  const state = loadState(layout.state);
  state.milestones[0]!.status = "done";
  state.runComplete = true;
  writeFileSync(layout.state, JSON.stringify(state));

  const added = appendMilestone(layout, "the afterthought");
  assert.equal(added.runResumed, true, "the caller is told the flag was cleared");

  const after = loadState(layout.state) as RunState;
  assert.equal(after.runComplete, false, "the runner's top-of-loop check would otherwise exit before reaching the new entry");
  assert.equal(nextMilestone(after)?.id, "M02", "the selection the runner uses finds the appended milestone");
});

test("the next id comes from the highest numeric suffix, not the count", () => {
  const layout = scaffold("add-gaps", 1);
  const state = loadState(layout.state);
  state.milestones[0]!.id = "M07";
  state.milestones[0]!.prompt = "M07.md";
  writeFileSync(layout.state, JSON.stringify(state));

  assert.equal(appendMilestone(layout).id, "M08", "an id after a renumbered plan cannot collide with what is there");
});
