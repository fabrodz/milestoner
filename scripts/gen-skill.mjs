import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_NAME, SKILL_TEMPLATE } from "../src/templates/skill.ts";

// Regenerates the plugin's shipped supervisor skill from the single source of
// truth in src/templates/skill.ts. A drift-guard test asserts the two match.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "skills", SKILL_NAME);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "SKILL.md"), SKILL_TEMPLATE, "utf8");
