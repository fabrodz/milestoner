import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SKILL_NAME, SKILL_TEMPLATE } from "../templates/skill.js";
import { ensureDir } from "../util/fs.js";
import { color, fail, ok, warn } from "../util/log.js";

export interface SkillOptions {
  projectRoot: string;
  global: boolean;
  force: boolean;
  print: boolean;
}

export function installSkill(options: SkillOptions): number {
  if (options.print) {
    process.stdout.write(SKILL_TEMPLATE);
    return 0;
  }

  const base = options.global ? homedir() : options.projectRoot;
  const dir = join(base, ".claude", "skills", SKILL_NAME);
  const file = join(dir, "SKILL.md");

  if (existsSync(file) && !options.force) {
    warn(`${file} already exists - use --force to overwrite`);
    return 1;
  }

  try {
    ensureDir(dir);
    writeFileSync(file, SKILL_TEMPLATE, "utf8");
  } catch (err) {
    fail(`could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  ok(`installed ${SKILL_NAME} to ${file}`);
  console.log(`
Start supervising a run with:

  ${color.bold(`/loop 10m Use the ${SKILL_NAME} skill to perform one supervision cycle.`)}

The skill reads the run through ${color.bold("runpulse status --json")} and may only intervene with
${color.bold("runpulse kill")}, ${color.bold("runpulse attend")}, and relaunching ${color.bold("runpulse run")}.
`);
  return 0;
}
