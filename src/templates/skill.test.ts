import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SKILL_NAME, SKILL_TEMPLATE } from "./skill.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the skill has the frontmatter Claude Code needs to discover it", () => {
  const [, frontmatter] = SKILL_TEMPLATE.split("---\n", 3);
  assert.ok(frontmatter, "no frontmatter block");
  assert.match(frontmatter, new RegExp(`^name: ${SKILL_NAME}$`, "m"));
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  assert.ok(description.length > 60, "the description is what triggers the skill; it must describe when to use it");
});

test("the playbook only reaches for commands the engine actually exposes", () => {
  // Only the ones written as code: prose says "dogwatch autonomous run" too.
  const invocations = [...SKILL_TEMPLATE.matchAll(/(?:`|^)dogwatch ([a-z]+)/gm)];
  const commands = new Set(invocations.map((m) => m[1]).filter((c): c is string => Boolean(c)));
  assert.deepEqual([...commands].sort(), ["attend", "kill", "run", "status", "steer", "unblock"]);
});

test("the playbook keeps its bounded shape", () => {
  for (let rule = 1; rule <= 8; rule += 1) {
    assert.match(SKILL_TEMPLATE, new RegExp(`\\*\\*${rule}\\.`), `rule ${rule} is missing`);
  }
  assert.match(SKILL_TEMPLATE, /first matching rule wins/i);
});

test("the plugin ships the same skill text the CLI writes", () => {
  // Drift guard: skills/<name>/SKILL.md is generated from SKILL_TEMPLATE by
  // `npm run gen:skill`. If someone edits one and not the other, this fails.
  const shipped = readFileSync(join(repoRoot, "skills", SKILL_NAME, "SKILL.md"), "utf8");
  assert.equal(shipped, SKILL_TEMPLATE, "run `npm run gen:skill` to regenerate the shipped skill");
});
