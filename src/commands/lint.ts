import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lintRun, type LintFinding, type LintInput } from "../lint.js";
import type { Layout } from "../paths.js";
import { loadState } from "../state.js";
import type { MilestonerConfig } from "../types.js";
import { color, fail } from "../util/log.js";

const SEVERITY: Record<LintFinding["severity"], string> = {
  error: color.red("error  "),
  warning: color.yellow("warning"),
};

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Only .md files count as prompts: an editor backup or .DS_Store is not an orphan worth a finding.
function promptFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
}

export interface LintOptions {
  config: MilestonerConfig;
  layout: Layout;
  json: boolean;
}

export function lint(options: LintOptions): number {
  const { config, layout } = options;

  if (!existsSync(layout.state)) {
    fail(`no run to lint - ${layout.state} does not exist; scaffold one with \`milestoner init\``);
    return 1;
  }
  const state = loadState(layout.state);

  const input: LintInput = {
    run: state.run,
    milestones: state.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      prompt: m.prompt,
      text: readIfPresent(join(layout.prompts, m.prompt)),
    })),
    promptFiles: promptFilesIn(layout.prompts),
    protocol: readIfPresent(layout.protocol),
    livenessCount: config.liveness.length,
  };

  const findings = lintRun(input);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;

  if (options.json) {
    console.log(JSON.stringify({ run: state.run, errors, warnings, findings }, null, 2));
    return errors > 0 ? 1 : 0;
  }

  const spell = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const summary = `${spell(errors, "error")}, ${spell(warnings, "warning")}`;

  if (findings.length === 0) {
    console.log(`\n${color.green("all clear")} - run "${state.run}", ${spell(state.milestones.length, "milestone")} checked`);
    console.log(`\n${summary}\n`);
    return 0;
  }

  const print = (f: LintFinding) => {
    const at = f.line === undefined ? f.file : `${f.file}:${f.line}`;
    console.log(`  ${SEVERITY[f.severity]}  ${f.rule.padEnd(21)}  ${f.message}  ${color.dim(at)}`);
  };

  const runLevel = findings.filter((f) => f.milestone === null);
  if (runLevel.length > 0) {
    console.log(`\n${color.bold(`run "${state.run}"`)}`);
    for (const f of runLevel) print(f);
  }
  for (const m of state.milestones) {
    const own = findings.filter((f) => f.milestone === m.id);
    if (own.length === 0) continue;
    console.log(`\n${color.bold(m.id)}  ${m.title}`);
    for (const f of own) print(f);
  }

  console.log(`\n${errors > 0 ? color.red(summary) : color.yellow(summary)}\n`);
  return errors > 0 ? 1 : 0;
}
