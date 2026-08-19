import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeResult } from "./result.js";

test("done with evidence is done", () => {
  const v = gradeResult({ milestone: "M01", status: "done", evidence: ["AC1: 42 tests green"] }, "M01");
  assert.equal(v.outcome, "done");
  assert.deepEqual(v.evidence, ["AC1: 42 tests green"]);
  assert.deepEqual(v.warnings, []);
});

test("done without evidence is downgraded to incomplete", () => {
  const v = gradeResult({ milestone: "M01", status: "done", evidence: [] }, "M01");
  assert.equal(v.outcome, "incomplete");
  assert.match(v.warnings[0] ?? "", /no evidence/);
});

test("a missing result file is incomplete", () => {
  const v = gradeResult(null, "M01");
  assert.equal(v.outcome, "incomplete");
  assert.match(v.warnings[0] ?? "", /no result.json/);
});

test("a result for another milestone is ignored", () => {
  const v = gradeResult({ milestone: "M02", status: "done", evidence: ["x"] }, "M01");
  assert.equal(v.outcome, "incomplete");
  assert.match(v.warnings[0] ?? "", /expected "M01"/);
});

test("blocked keeps a complete diagnosis", () => {
  const v = gradeResult(
    {
      milestone: "M01",
      status: "blocked",
      diagnosis: { symptom: "editor unreachable", tried: ["restart mcp"], userAction: "reopen the editor" },
    },
    "M01",
  );
  assert.equal(v.outcome, "blocked");
  assert.equal(v.diagnosis?.userAction, "reopen the editor");
  assert.deepEqual(v.warnings, []);
});

test("blocked without a diagnosis still blocks but warns", () => {
  const v = gradeResult({ milestone: "M01", status: "blocked" }, "M01");
  assert.equal(v.outcome, "blocked");
  assert.equal(v.diagnosis, null);
  assert.match(v.warnings[0] ?? "", /without a diagnosis/);
});

test("an unknown status is incomplete", () => {
  const v = gradeResult({ milestone: "M01", status: "finished" } as never, "M01");
  assert.equal(v.outcome, "incomplete");
  assert.match(v.warnings[0] ?? "", /unknown status/);
});
