import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import type { Layout } from "../paths.js";
import { readSteering } from "../steering.js";
import { ensureDir, removeIfExists } from "../util/fs.js";
import { color, info, ok, warn } from "../util/log.js";

export interface SteerOptions {
  layout: Layout;
  text?: string;
  append: boolean;
  clear: boolean;
}

// A comment, so the note to the human editing this file never reaches the agent's kickoff.
const HEADER =
  "<!--\nSteering: read by every session launched from now on, as an override on the milestone prompt.\nEverything outside these comments is sent to the agent verbatim. Keep it short and imperative.\nClear it with `dogwatch steer --clear` once it has served its purpose.\n-->\n\n";

/**
 * The user's mid-flight channel into a running run: a correction that reaches the next session
 * without killing the current one. It is deliberately the user's alone - the supervisor cannot
 * write here.
 */
export function steer(options: SteerOptions): number {
  const { layout } = options;
  const rel = relative(process.cwd(), layout.steering) || layout.steering;

  if (options.clear) {
    if (!existsSync(layout.steering)) {
      warn("no steering to clear");
      return 0;
    }
    removeIfExists(layout.steering);
    ok(`cleared ${rel} - the next session runs on its milestone prompt alone`);
    return 0;
  }

  if (options.text === undefined) {
    const current = readSteering(layout.steering);
    if (!current) {
      info(`no steering in force (${rel} is absent or empty)`);
      info(`  set some with: ${color.bold('dogwatch steer "prefer the simpler fix over the general one"')}`);
      return 0;
    }
    console.log(`\n${color.bold("steering in force")}  ${color.dim(rel)}\n`);
    console.log(current.text);
    if (current.truncated) warn("\nlonger than the injection limit - sessions see the first 4000 characters only");
    console.log("");
    return 0;
  }

  ensureDir(layout.dir);
  const existing = existsSync(layout.steering) ? readFileSync(layout.steering, "utf8") : HEADER;
  const body = options.append ? `${existing.trimEnd()}\n- ${options.text}\n` : `${HEADER}- ${options.text}\n`;
  writeFileSync(layout.steering, body, "utf8");

  ok(`steering ${options.append ? "appended" : "set"} - it applies to the next session launched`);
  info(`  ${rel}`);
  return 0;
}
