import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PLANNER_SKILL_NAME, PLANNER_SKILL_TEMPLATE } from "./planner.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const lf = (text: string): string => text.replace(/\r\n/g, "\n");

test("the planner skill has the frontmatter Claude Code needs to discover it", () => {
  const [, frontmatter] = lf(PLANNER_SKILL_TEMPLATE).split("---\n", 3);
  assert.ok(frontmatter, "no frontmatter block");
  assert.match(frontmatter, new RegExp(`^name: ${PLANNER_SKILL_NAME}$`, "m"));
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  assert.ok(description.length > 60, "the description is what triggers the skill; it must describe when to use it");
});

test("the planner only reaches for commands the engine actually exposes", () => {
  const invocations = [...PLANNER_SKILL_TEMPLATE.matchAll(/(?:`|^)milestoner ([a-z]+)/gm)];
  const commands = new Set(invocations.map((m) => m[1]).filter((c): c is string => Boolean(c)));
  assert.deepEqual([...commands].sort(), ["init", "run", "status"]);
});

test("the planner keeps the D-031 boundary: user approval before writing, no invented criteria", () => {
  assert.match(PLANNER_SKILL_TEMPLATE, /Nothing is written to disk before the user approves/);
  assert.match(PLANNER_SKILL_TEMPLATE, /Never invent an acceptance criterion/);
});

test("the planner names state.json only inside a guard and never spells the human-only commands", () => {
  assert.match(PLANNER_SKILL_TEMPLATE, /Never edit `\.milestoner\/state\.json` except the milestone titles/);
  assert.doesNotMatch(PLANNER_SKILL_TEMPLATE, /milestoner unblock/);
  assert.doesNotMatch(PLANNER_SKILL_TEMPLATE, /milestoner steer/);
});

test("the plugin ships the same planner text the CLI writes", () => {
  const shipped = readFileSync(join(repoRoot, "skills", PLANNER_SKILL_NAME, "SKILL.md"), "utf8");
  assert.equal(lf(shipped), lf(PLANNER_SKILL_TEMPLATE), "run `npm run gen:skill` to regenerate the shipped skill");
});
