import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { defaultConfig, renderTemplate } from "../config.js";
import { layoutFor } from "../paths.js";
import { MILESTONE_TEMPLATE } from "../templates/milestone.js";
import { SUPERVISOR_LOG_HEADER } from "../supervisorLog.js";
import { PROTOCOL_TEMPLATE } from "../templates/protocol.js";
import type { Milestone, RunState } from "../types.js";
import { ensureDir, writeFileIfMissing, writeJsonAtomic } from "../util/fs.js";
import { color, info, ok, step, warn } from "../util/log.js";
import { iso } from "../util/time.js";

export interface InitOptions {
  projectRoot: string;
  run?: string;
  count: number;
  force: boolean;
}

const RUNPULSE_GITIGNORE = `logs/
results/
result.json
pulse.json
kill.json
report.html
`;

export function init(options: InitOptions): number {
  const layout = layoutFor(options.projectRoot);
  const run = options.run ?? basename(options.projectRoot).toLowerCase().replace(/[^a-z0-9]+/g, "-");

  if (existsSync(layout.config) && !options.force) {
    warn(`${layout.config} already exists - use --force to overwrite the config`);
    return 1;
  }

  ensureDir(layout.dir);
  ensureDir(layout.prompts);
  ensureDir(layout.logs);
  ensureDir(layout.results);

  const milestones: Milestone[] = [];
  for (let i = 1; i <= options.count; i += 1) {
    const id = `M${String(i).padStart(2, "0")}`;
    const promptFile = `${id}.md`;
    milestones.push({
      id,
      title: `TODO: milestone ${i} title`,
      prompt: promptFile,
      status: "pending",
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      evidence: [],
      diagnosis: null,
      history: [],
    });
    const created = writeFileIfMissing(
      join(layout.prompts, promptFile),
      renderTemplate(MILESTONE_TEMPLATE, { id, title: `TODO: milestone ${i} title`, run }),
    );
    if (created) info(`prompts/${promptFile}`);
  }

  const state: RunState = { run, createdAt: iso(), runComplete: false, milestones };

  writeJsonAtomic(layout.config, defaultConfig(run, "."));
  info("config.json");

  if (!existsSync(layout.state) || options.force) {
    writeJsonAtomic(layout.state, state);
    info("state.json");
  } else {
    warn("state.json kept (already present)");
  }

  if (writeFileIfMissing(layout.protocol, renderTemplate(PROTOCOL_TEMPLATE, { run }))) info("protocol.md");
  if (writeFileIfMissing(join(layout.dir, ".gitignore"), RUNPULSE_GITIGNORE)) info(".gitignore");
  if (writeFileIfMissing(join(layout.dir, "execution-log.md"), `# Execution log - ${run}\n`)) info("execution-log.md");
  if (writeFileIfMissing(join(layout.dir, "decisions.md"), `# Decisions - ${run}\n`)) info("decisions.md");
  if (writeFileIfMissing(layout.supervisorLog, SUPERVISOR_LOG_HEADER)) info("supervisor-log.md");

  step(`initialized .runpulse/ for run "${run}"`);
  console.log(`
Next:
  1. ${color.bold("Edit .runpulse/protocol.md")} - replace every TODO with this project's rules.
  2. ${color.bold("Write .runpulse/prompts/M01.md")} and friends - objective, tasks, acceptance criteria, exit.
  3. Set the titles in .runpulse/state.json to match.
  4. Point ${color.bold('"liveness"')} in config.json at the paths that prove work is happening
     (source dirs, test-result files, tool logs). The transcript is never one.
  5. ${color.bold("runpulse run")}

To supervise a long run, install the supervisor skill and loop it:
  ${color.bold("runpulse skill install")}
  ${color.bold("/loop 10m Use the runpulse-supervisor skill to perform one supervision cycle.")}
`);
  ok("ready");
  return 0;
}
