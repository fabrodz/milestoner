import assert from "node:assert/strict";
import { test } from "node:test";
import { secondsUntilReset } from "./time.js";

// Local time on purpose: the function resolves the reset against the machine's clock.
const at = (hour: number, minute = 0) => new Date(2026, 7, 21, hour, minute, 0, 0);

test("a pm reset later today waits until that time, plus the 30s pad", () => {
  const s = secondsUntilReset("You've hit your session limit · resets 3:00pm", at(14));
  assert.equal(s, 3600 + 30);
});

test("a bare hour and 24-hour time both parse", () => {
  assert.equal(secondsUntilReset("resets 5pm", at(16)), 3600 + 30);
  assert.equal(secondsUntilReset("resets at 15:30", at(14)), 5400 + 30);
});

test("noon and midnight follow am/pm, not the 0-11 arithmetic", () => {
  assert.equal(secondsUntilReset("resets 12pm", at(10)), 2 * 3600 + 30);
  assert.equal(secondsUntilReset("resets 12am", at(22)), 2 * 3600 + 30);
});

test("a time already past rolls to tomorrow while the wait stays plausible", () => {
  assert.equal(secondsUntilReset("resets 9am", at(22)), 11 * 3600 + 30);
});

test("a rolled-over wait beyond 12 hours is not a reset worth sleeping on", () => {
  // "resets 1pm" read at 2pm would mean 23 idle hours; a limit never announces that far out,
  // so the text was misread and the caller must fall back to its own retry policy.
  assert.equal(secondsUntilReset("resets 1pm", at(14)), null);
});

test("text without a reset time, or with an impossible one, yields null", () => {
  assert.equal(secondsUntilReset("Execution error", at(14)), null);
  assert.equal(secondsUntilReset("resets 25:00", at(14)), null);
  assert.equal(secondsUntilReset("resets 10:75", at(14)), null);
});
