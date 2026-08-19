import assert from "node:assert/strict";
import { test } from "node:test";
import { STEERING_LIMIT, parseSteering } from "./steering.js";

test("an empty or comment-only steering file means no steering", () => {
  assert.equal(parseSteering(""), null);
  assert.equal(parseSteering("   \n\n  "), null);
  assert.equal(parseSteering("<!-- write your correction below -->\n\n"), null);
});

test("the headline skips headings so logs show the actual instruction", () => {
  const steering = parseSteering("# Steering\n\n- prefer the simpler fix over the general one\n");
  assert.equal(steering?.headline, "- prefer the simpler fix over the general one");
});

test("steering longer than the injection limit is truncated, not dropped", () => {
  const steering = parseSteering(`- ${"x".repeat(STEERING_LIMIT + 500)}`);
  assert.equal(steering?.truncated, true);
  assert.ok((steering?.text.length ?? 0) < STEERING_LIMIT + 30);
  assert.ok(steering?.text.endsWith("[...truncated]"));
});
