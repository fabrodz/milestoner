import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PLANNER_SKILL_NAME, PLANNER_SKILL_TEMPLATE } from "../templates/planner.js";
import { SKILL_NAME, SKILL_TEMPLATE } from "../templates/skill.js";
import { installSkill } from "./skill.js";

const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");

function capture(fn: () => number): { code: number; out: string; stdout: string } {
  const lines: string[] = [];
  const writes: string[] = [];
  const log = console.log;
  const error = console.error;
  const write = process.stdout.write;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  process.stdout.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: fn(), out: plain(lines.join("\n")), stdout: writes.join("") };
  } finally {
    console.log = log;
    console.error = error;
    process.stdout.write = write;
  }
}

const root = () => mkdtempSync(join(tmpdir(), "milestoner-skill-"));
const fileOf = (base: string, name: string) => join(base, ".claude", "skills", name, "SKILL.md");
const install = (options: Partial<Parameters<typeof installSkill>[0]> & { projectRoot: string }) =>
  capture(() => installSkill({ global: false, force: false, print: false, ...options }));

test("with no name, both bundled skills land under .claude/skills/", () => {
  const base = root();
  const { code } = install({ projectRoot: base });
  assert.equal(code, 0);
  assert.equal(readFileSync(fileOf(base, SKILL_NAME), "utf8"), SKILL_TEMPLATE);
  assert.equal(readFileSync(fileOf(base, PLANNER_SKILL_NAME), "utf8"), PLANNER_SKILL_TEMPLATE);
});

test("an alias selects one skill and leaves the other uninstalled", () => {
  const base = root();
  const { code } = install({ projectRoot: base, name: "planner" });
  assert.equal(code, 0);
  assert.ok(existsSync(fileOf(base, PLANNER_SKILL_NAME)));
  assert.ok(!existsSync(fileOf(base, SKILL_NAME)));
});

test("an unknown name fails and lists what is bundled", () => {
  const { code, out } = install({ projectRoot: root(), name: "linter" });
  assert.equal(code, 1);
  assert.match(out, /unknown skill "linter"/);
  assert.match(out, new RegExp(SKILL_NAME));
  assert.match(out, new RegExp(PLANNER_SKILL_NAME));
});

test("--print needs a name, and with one writes the template to stdout and nothing to disk", () => {
  const base = root();
  const bare = install({ projectRoot: base, print: true });
  assert.equal(bare.code, 1);
  assert.match(bare.out, /--print needs a skill name/);

  const printed = install({ projectRoot: base, name: "supervisor", print: true });
  assert.equal(printed.code, 0);
  assert.equal(printed.stdout, SKILL_TEMPLATE);
  assert.ok(!existsSync(fileOf(base, SKILL_NAME)), "--print must not install");
});

test("an existing file is refused without --force and overwritten with it", () => {
  const base = root();
  install({ projectRoot: base, name: "supervisor" });
  writeFileSync(fileOf(base, SKILL_NAME), "hand-edited\n");

  const refused = install({ projectRoot: base, name: "supervisor" });
  assert.equal(refused.code, 1);
  assert.match(refused.out, /already exists - use --force/);
  assert.equal(readFileSync(fileOf(base, SKILL_NAME), "utf8"), "hand-edited\n");

  const forced = install({ projectRoot: base, name: "supervisor", force: true });
  assert.equal(forced.code, 0);
  assert.equal(readFileSync(fileOf(base, SKILL_NAME), "utf8"), SKILL_TEMPLATE);
});

test("a supervisor skill from before the rename earns a warning, not a deletion", () => {
  const base = root();
  const stale = join(base, ".claude", "skills", "dogwatch-supervisor");
  mkdirSync(stale, { recursive: true });

  const { code, out } = install({ projectRoot: base });
  assert.equal(code, 0);
  assert.match(out, /before the rename is still installed/);
  assert.ok(existsSync(stale), "files under .claude/ are the user's to delete");
});
