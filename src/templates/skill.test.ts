import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILL_NAME, SKILL_TEMPLATE } from "./skill.js";

test("the skill has the frontmatter Claude Code needs to discover it", () => {
  const [, frontmatter] = SKILL_TEMPLATE.split("---\n", 3);
  assert.ok(frontmatter, "no frontmatter block");
  assert.match(frontmatter, new RegExp(`^name: ${SKILL_NAME}$`, "m"));
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  assert.ok(description.length > 60, "the description is what triggers the skill; it must describe when to use it");
});

test("the playbook only reaches for commands the engine actually exposes", () => {
  // Only the ones written as code: prose says "pulseflow autonomous run" too.
  const invocations = [...SKILL_TEMPLATE.matchAll(/(?:`|^)pulseflow ([a-z]+)/gm)];
  const commands = new Set(invocations.map((m) => m[1]).filter((c): c is string => Boolean(c)));
  assert.deepEqual([...commands].sort(), ["attend", "kill", "run", "status", "steer", "unblock"]);
});

test("the playbook keeps its bounded shape", () => {
  for (let rule = 1; rule <= 8; rule += 1) {
    assert.match(SKILL_TEMPLATE, new RegExp(`\\*\\*${rule}\\.`), `rule ${rule} is missing`);
  }
  assert.match(SKILL_TEMPLATE, /first matching rule wins/i);
});
