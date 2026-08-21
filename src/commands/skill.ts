import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLANNER_SKILL_NAME, PLANNER_SKILL_TEMPLATE } from "../templates/planner.js";
import { SKILL_NAME, SKILL_TEMPLATE } from "../templates/skill.js";
import { ensureDir } from "../util/fs.js";
import { color, fail, ok, warn } from "../util/log.js";

export interface BundledSkill {
  name: string;
  alias: string;
  template: string;
  next: string;
}

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  {
    name: SKILL_NAME,
    alias: "supervisor",
    template: SKILL_TEMPLATE,
    next: `Start supervising a run with:

  ${color.bold(`/loop 10m Use the ${SKILL_NAME} skill to perform one supervision cycle.`)}

The skill reads the run through ${color.bold("milestoner status --json")} and may only intervene with
${color.bold("milestoner kill")}, ${color.bold("milestoner attend")}, and relaunching ${color.bold("milestoner run")}.`,
  },
  {
    name: PLANNER_SKILL_NAME,
    alias: "planner",
    template: PLANNER_SKILL_TEMPLATE,
    next: `Plan a run by asking Claude, in a session at the project root:

  ${color.bold(`Use the ${PLANNER_SKILL_NAME} skill to plan a milestoner run for <goal>.`)}

It interviews you, proposes a milestone breakdown for approval, and only then writes the prompts,
the protocol TODOs and the liveness config.`,
  },
];

export interface SkillOptions {
  projectRoot: string;
  name?: string;
  global: boolean;
  force: boolean;
  print: boolean;
}

function skillNames(): string {
  return BUNDLED_SKILLS.map((s) => `${s.name} (${s.alias})`).join(", ");
}

export function installSkill(options: SkillOptions): number {
  let selected: readonly BundledSkill[] = BUNDLED_SKILLS;
  if (options.name) {
    const match = BUNDLED_SKILLS.find((s) => s.name === options.name || s.alias === options.name);
    if (!match) {
      fail(`unknown skill "${options.name}" - bundled skills: ${skillNames()}`);
      return 1;
    }
    selected = [match];
  }

  if (options.print) {
    if (selected.length > 1) {
      fail(`--print needs a skill name - bundled skills: ${skillNames()}`);
      return 1;
    }
    process.stdout.write(selected[0]!.template);
    return 0;
  }

  const base = options.global ? homedir() : options.projectRoot;
  let failures = 0;
  const installed: BundledSkill[] = [];

  for (const skill of selected) {
    const dir = join(base, ".claude", "skills", skill.name);
    const file = join(dir, "SKILL.md");

    if (existsSync(file) && !options.force) {
      warn(`${file} already exists - use --force to overwrite`);
      failures += 1;
      continue;
    }

    try {
      ensureDir(dir);
      writeFileSync(file, skill.template, "utf8");
    } catch (err) {
      fail(`could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
      continue;
    }

    ok(`installed ${skill.name} to ${file}`);
    installed.push(skill);
  }

  for (const old of ["dogwatch-supervisor", "pulseflow-supervisor", "runpulse-supervisor"]) {
    const stale = join(base, ".claude", "skills", old);
    if (!existsSync(stale)) continue;
    warn(`a supervisor skill from before the rename is still installed at ${stale}`);
    warn(`  it tells the agent to run \`${old.replace("-supervisor", "")} ...\`, which no longer exists - delete that directory`);
  }

  for (const skill of installed) {
    console.log(`\n${skill.next}`);
  }
  if (installed.length > 0) console.log();

  return failures > 0 ? 1 : 0;
}
