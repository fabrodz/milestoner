import assert from "node:assert/strict";
import { test } from "node:test";
import { nextMilestone, normalizeState, summarize } from "./state.js";

const legacy = {
  run: "reference-run-v1.1",
  createdAt: "2026-08-18",
  mvpComplete: true,
  milestones: [
    { id: "V01", title: "Stability", prompt: "V01.md", status: "done", attempts: 0, evidence: "EditMode 271/271" },
    { id: "V02", title: "Data", prompt: "V02.md", status: "pending", attempts: 2 },
  ],
};

test("a pre-v0.1 state file loads: mvpComplete and string evidence", () => {
  const state = normalizeState(legacy);
  assert.equal(state.runComplete, true);
  assert.deepEqual(state.milestones[0]?.evidence, ["EditMode 271/271"]);
  assert.deepEqual(state.milestones[1]?.evidence, []);
  assert.deepEqual(state.milestones[0]?.history, []);
});

test("an unknown status falls back to pending", () => {
  const state = normalizeState({ ...legacy, milestones: [{ id: "M01", status: "half-done" }] });
  assert.equal(state.milestones[0]?.status, "pending");
});

test("state with no milestones is rejected", () => {
  assert.throws(() => normalizeState({ run: "x", milestones: [] }), /no milestones/);
});

test("the next milestone is the first that is not done", () => {
  const state = normalizeState(legacy);
  assert.equal(nextMilestone(state)?.id, "V02");
  assert.deepEqual(summarize(state), { done: 1, total: 2, blocked: 0 });
});
