import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const commandsDir = join(repoRoot, "commands");

// The commands the plugin ships. Every CLI command that was considered and rejected
// (run, serve, unblock, steer, kill, attend, skill install) is recorded in docs/DECISIONS.md D-018.
const SHIPPED = ["milestoner-init", "milestoner-status", "milestoner-supervise", "milestoner-report"];

function read(name: string): string {
  return readFileSync(join(commandsDir, `${name}.md`), "utf8");
}

function frontmatterOf(text: string): string {
  const [, frontmatter] = text.split("---\n", 3);
  return frontmatter ?? "";
}

for (const name of SHIPPED) {
  test(`the plugin ships /${name} with the frontmatter the runtime needs`, () => {
    assert.ok(existsSync(join(commandsDir, `${name}.md`)), `commands/${name}.md is missing`);
    const frontmatter = frontmatterOf(read(name));
    assert.ok(frontmatter, "no frontmatter block");
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
    assert.ok(description.length > 40, "the description is what the runtime lists and matches on; it must say what the command does");
  });
}

test("no command hands the model a path the supervisor is denied", () => {
  // Hard rule (M02 task 3): a command may not give a model a route to `unblock`, `steer`,
  // or editing state.json that the supervisor skill forbids. state.json is only ever named
  // inside a guard, and the two human-only commands are never spelled as runnable invocations.
  for (const name of SHIPPED) {
    const body = read(name);
    assert.doesNotMatch(body, /milestoner unblock/, `${name} spells out a runnable unblock`);
    assert.doesNotMatch(body, /milestoner steer/, `${name} spells out a runnable steer`);
    if (/state\.json/.test(body)) {
      assert.match(body, /never/i, `${name} names state.json without a guard`);
    }
  }
});
