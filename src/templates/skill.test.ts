import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILL_NAME, SKILL_TEMPLATE } from "./skill.js";

const lf = (text: string): string => text.replace(/\r\n/g, "\n");

test("the supervisor skill has the frontmatter Claude Code needs to discover it", () => {
  const [, frontmatter] = lf(SKILL_TEMPLATE).split("---\n", 3);
  assert.ok(frontmatter, "no frontmatter block");
  assert.match(frontmatter, new RegExp(`^name: ${SKILL_NAME}$`, "m"));
});

test("the supervisor only reaches for commands the engine actually exposes", () => {
  const invocations = [...SKILL_TEMPLATE.matchAll(/(?:`|^)milestoner ([a-z]+)/gm)];
  const commands = new Set(invocations.map((m) => m[1]).filter((c): c is string => Boolean(c)));
  // steer and unblock are in there to be forbidden, which still has to be a real command name.
  assert.deepEqual([...commands].sort(), ["attend", "kill", "run", "status", "steer", "transcript", "unblock"]);
});

test("the supervisor is told to read the transcript, and told it is only a read", () => {
  assert.match(SKILL_TEMPLATE, /milestoner transcript --lines 40/);
  assert.match(SKILL_TEMPLATE, /It is a read, never an intervention/);
  // The write surface is a closed list; reading must not have quietly widened it.
  assert.match(SKILL_TEMPLATE, /Your entire write surface is: `milestoner kill`, `milestoner attend`/);
});

test("liveness and diagnosis stay separate, and the stale reason is gone", () => {
  assert.match(SKILL_TEMPLATE, /Never widen a liveness rule to include the transcript/);
  assert.doesNotMatch(
    SKILL_TEMPLATE,
    /flushes its output only when\s+it exits/,
    "the transcript streams now; the rule survives on the reason in D-040, not on that one",
  );
});

test("an agent whose output this cannot render is not treated as a fault to fix", () => {
  assert.match(SKILL_TEMPLATE, /does not\s+stream a format this knows/);
  assert.match(SKILL_TEMPLATE, /not something for you to fix/);
});

test("unblock and steer stay human decisions", () => {
  assert.match(SKILL_TEMPLATE, /`milestoner unblock` and `milestoner steer` are \*\*not\*\* yours/);
});
