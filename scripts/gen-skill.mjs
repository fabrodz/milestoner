import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANNER_SKILL_NAME, PLANNER_SKILL_TEMPLATE } from "../src/templates/planner.ts";
import { SKILL_NAME, SKILL_TEMPLATE } from "../src/templates/skill.ts";

// Regenerates the plugin's shipped skills from the single source of truth in
// src/templates/. A drift-guard test per skill asserts the pairs match.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const [name, template] of [
  [SKILL_NAME, SKILL_TEMPLATE],
  [PLANNER_SKILL_NAME, PLANNER_SKILL_TEMPLATE],
]) {
  const dir = join(root, "skills", name);
  mkdirSync(dir, { recursive: true });
  // LF unconditionally: this file is generated on whatever platform runs `npm run build`, and it is
  // committed, so anything else makes the build produce a diff on Windows and none on Linux.
  writeFileSync(join(dir, "SKILL.md"), template.replace(/\r\n/g, "\n"), "utf8");
}
