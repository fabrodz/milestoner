import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { defaultConfig, renderTemplate } from "../config.js";
import { layoutFor } from "../paths.js";
import { MILESTONE_TEMPLATE } from "../templates/milestone.js";
import { SUPERVISOR_LOG_HEADER } from "../supervisorLog.js";
import { PROTOCOL_TEMPLATE } from "../templates/protocol.js";
import type { Milestone, RunState } from "../types.js";
import { ensureDir, writeFileIfMissing, writeJsonAtomic } from "../util/fs.js";
import { color, fail, info, ok, step, warn } from "../util/log.js";
import { iso } from "../util/time.js";

export interface InitOptions {
  projectRoot: string;
  run?: string;
  count: number;
  force: boolean;
}

export function protocolRunName(protocol: string): string | null {
  return protocol.match(/^# Execution protocol - run "(.+)"/m)?.[1] ?? null;
}

const MILESTONER_GITIGNORE = `logs/
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

  // The protocol is hand-edited, so init never rewrites or deletes it. What it must not do is
  // silently keep one that belongs to another run: every session would read that run's rules.
  if (existsSync(layout.protocol)) {
    const named = protocolRunName(readFileSync(layout.protocol, "utf8"));
    if (named !== null && named !== run) {
      fail(`.milestoner/protocol.md names run "${named}", not "${run}" - a session would read the old run's rules`);
      console.log(`
  Nothing was scaffolded. Bring the protocol in line yourself - at least the run name in its
  header and the tag line in its Git section (tag \`${run}-<milestoneId>\`) - or delete the file
  to get a fresh template, then run init again.
`);
      return 1;
    }
    if (named === null) {
      warn(`.milestoner/protocol.md does not name a run, so init cannot tell whether it belongs to "${run}" - check it by hand`);
    }
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

  const state: RunState = { run, createdAt: iso(), runComplete: false, rev: 0, milestones };

  // projectRoot is where the config was found, never what it says: writing it would only invite
  // an edit that does nothing.
  const { projectRoot: _root, ...config } = defaultConfig(run, options.projectRoot);
  writeJsonAtomic(layout.config, config);
  info("config.json");

  if (!existsSync(layout.state) || options.force) {
    writeJsonAtomic(layout.state, state);
    info("state.json");
  } else {
    warn("state.json kept (already present)");
  }

  if (writeFileIfMissing(layout.protocol, renderTemplate(PROTOCOL_TEMPLATE, { run }))) info("protocol.md");
  if (writeFileIfMissing(join(layout.dir, ".gitignore"), MILESTONER_GITIGNORE)) info(".gitignore");
  if (writeFileIfMissing(join(layout.dir, "execution-log.md"), `# Execution log - ${run}\n`)) info("execution-log.md");
  if (writeFileIfMissing(join(layout.dir, "decisions.md"), `# Decisions - ${run}\n`)) info("decisions.md");
  if (writeFileIfMissing(layout.supervisorLog, SUPERVISOR_LOG_HEADER)) info("supervisor-log.md");

  step(`initialized .milestoner/ for run "${run}"`);
  console.log(`
Next:
  1. ${color.bold("Edit .milestoner/protocol.md")} - replace every TODO with this project's rules.
  2. ${color.bold("Write .milestoner/prompts/M01.md")} and friends - objective, tasks, acceptance criteria, exit.
  3. Set the titles in .milestoner/state.json to match.
  4. Point ${color.bold('"liveness"')} in config.json at the paths that prove work is happening
     (source dirs, test-result files, tool logs). The transcript is never one.
  5. ${color.bold("milestoner run")}

Steps 1-4 are yours to author, but Claude can help: install the planner skill and ask for it.
  ${color.bold("milestoner skill install planner")}
  ${color.bold("Use the milestoner-planner skill to plan this run.")}

To supervise a long run, install the supervisor skill and loop it:
  ${color.bold("milestoner skill install supervisor")}
  ${color.bold("/loop 10m Use the milestoner-supervisor skill to perform one supervision cycle.")}
`);
  ok("ready");
  return 0;
}
