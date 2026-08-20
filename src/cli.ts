import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { attend } from "./commands/attend.js";
import { init } from "./commands/init.js";
import { kill } from "./commands/kill.js";
import { report } from "./commands/report.js";
import { runs } from "./commands/runs.js";
import { serve } from "./commands/serve.js";
import { installSkill } from "./commands/skill.js";
import { steer } from "./commands/steer.js";
import { status } from "./commands/status.js";
import { unblock } from "./commands/unblock.js";
import { loadConfig } from "./config.js";
import { MILESTONER_DIR, findLegacyRoot, findProjectRoot, layoutFor, registryPath } from "./paths.js";
import { run } from "./runner.js";
import { color, fail, warn } from "./util/log.js";

const USAGE = `
${color.bold("milestoner")} - supervised autonomous-run engine for coding agents

  milestoner init [--run <name>] [--milestones <n>] [--force]
      Scaffold .milestoner/ (config, state machine, protocol, prompt skeletons).

  milestoner run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]
      Drain the run: one fresh agent session per milestone until complete or blocked.

  milestoner status [--json]
      Milestones, attempts, evidence counts, and the pulse (is this run alive?).

  milestoner runs [--json]
      Every run registered on this machine, from anywhere: project, milestone, progress
      and liveness. Exits 2 if any of them is blocked or its runner is gone.

  milestoner unblock <id> [--keep-attempts]
      Clear a block after fixing it and set the milestone back to pending.

  milestoner steer ["<text>"] [--append] [--clear]
      Course-correct a run in flight. Applies to the next session launched.

  milestoner report [--out <path>] [--open]
      Write a single self-contained HTML report of the run.

  milestoner serve [--port <n>] [--write]
      Local web panel for the run. Binds 127.0.0.1 only and prints a URL carrying a
      one-time key. --write enables the controls; without it the panel only reads.

  milestoner skill install [--global] [--force] [--print]
      Install the supervisor skill into .claude/skills/ (--global: ~/.claude/skills/).

  milestoner kill [--reason <text>] [--rule <n>]
      Supervisor intervention: kill the hung agent session. The runner consumes the
      attempt and relaunches. Never kills the runner.

  milestoner attend [--seconds <n>] [--rule <n>]
      Supervisor intervention: run the configured environment adapter to unstick the host.

Exit codes: 0 ok, 1 error, 2 blocked.
`;

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
}

function requireProject(): { root: string; layout: ReturnType<typeof layoutFor> } | null {
  const root = findProjectRoot();
  if (root) return { root, layout: layoutFor(root) };

  const legacy = findLegacyRoot();
  if (legacy) {
    const from = join(legacy.root, legacy.dir);
    const to = join(legacy.root, MILESTONER_DIR);
    fail(`found ${from} - this run was set up before the tool was renamed to milestoner`);
    console.log(`
  The layout is derived from the directory name, so renaming the directory is the whole migration.
  Nothing inside it needs to change; a run in progress keeps its state, evidence and history.

    ${color.bold(process.platform === "win32" ? `ren "${from}" ${MILESTONER_DIR}` : `mv "${from}" "${to}"`)}

  If a supervisor skill from before the rename is installed, replace it too:
    ${color.bold("milestoner skill install")}   (then delete the old .claude/skills/ directory it names)
`);
    return null;
  }

  fail("no .milestoner/config.json found here or in any parent directory - run `milestoner init` first");
  return null;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      run: { type: "string" },
      milestones: { type: "string" },
      force: { type: "boolean" },
      milestone: { type: "string" },
      "max-attempts": { type: "string" },
      model: { type: "string" },
      once: { type: "boolean" },
      json: { type: "boolean" },
      "keep-attempts": { type: "boolean" },
      global: { type: "boolean" },
      print: { type: "boolean" },
      reason: { type: "string" },
      rule: { type: "string" },
      seconds: { type: "string" },
      append: { type: "boolean" },
      clear: { type: "boolean" },
      out: { type: "string" },
      open: { type: "boolean" },
      port: { type: "string" },
      write: { type: "boolean" },
      token: { type: "string" },
    },
  });

  const command = positionals[0];

  if (values.version) {
    console.log(version());
    return 0;
  }
  if (values.help || !command || command === "help") {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  if (command === "init") {
    const count = Number(values.milestones ?? 3);
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      fail("--milestones must be an integer between 1 and 99");
      return 1;
    }
    return init({
      projectRoot: resolve(process.cwd()),
      run: values.run,
      count,
      force: Boolean(values.force),
    });
  }

  if (command === "skill") {
    const action = positionals[1] ?? "install";
    if (action !== "install") {
      fail(`unknown skill action "${action}" - the only action is "install"`);
      return 1;
    }
    return installSkill({
      projectRoot: findProjectRoot() ?? resolve(process.cwd()),
      global: Boolean(values.global),
      force: Boolean(values.force),
      print: Boolean(values.print),
    });
  }

  // Deliberately before requireProject: answering "what is running on this machine" from a
  // directory that is not a project is the whole point of it.
  if (command === "runs") {
    return runs({ registry: registryPath(), json: Boolean(values.json) });
  }

  const project = requireProject();
  if (!project) return 1;
  const config = loadConfig(project.layout.config, project.root);

  if (command === "status") {
    return status({ config, layout: project.layout, json: Boolean(values.json) });
  }

  if (command === "unblock") {
    const id = positionals[1];
    if (!id) {
      fail("usage: milestoner unblock <milestoneId> [--keep-attempts]");
      return 1;
    }
    return unblock({ layout: project.layout, milestoneId: id, keepAttempts: Boolean(values["keep-attempts"]) });
  }

  if (command === "steer") {
    return steer({
      layout: project.layout,
      text: positionals.slice(1).join(" ") || undefined,
      append: Boolean(values.append),
      clear: Boolean(values.clear),
    });
  }

  if (command === "report") {
    return report({ config, layout: project.layout, out: values.out, open: Boolean(values.open) });
  }

  if (command === "serve") {
    const port = values.port ? Number(values.port) : 4400;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail("--port must be an integer between 1 and 65535");
      return 1;
    }
    return serve({ config, layout: project.layout, port, write: Boolean(values.write), token: values.token });
  }

  if (command === "kill") {
    return await kill({
      layout: project.layout,
      reason: values.reason ?? "no reason given",
      rule: values.rule ? `rule ${values.rule}` : "manual",
    });
  }

  if (command === "attend") {
    const seconds = values.seconds ? Number(values.seconds) : undefined;
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 1)) {
      fail("--seconds must be a positive integer");
      return 1;
    }
    return attend({
      config,
      layout: project.layout,
      seconds,
      rule: values.rule ? `rule ${values.rule}` : "manual",
    });
  }

  if (command === "run") {
    const stopController = new AbortController();
    const killController = new AbortController();
    let interrupts = 0;
    process.on("SIGINT", () => {
      interrupts += 1;
      if (interrupts === 1) {
        warn("\ninterrupt received - finishing the current session, then stopping (Ctrl-C again to kill it now)");
        stopController.abort();
      } else if (interrupts === 2) {
        warn("killing the agent session - the milestone stays in_progress and is retried on the next run");
        killController.abort();
      } else {
        process.exit(130);
      }
    });

    const maxAttempts = values["max-attempts"] ? Number(values["max-attempts"]) : undefined;
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
      fail("--max-attempts must be a positive integer");
      return 1;
    }

    const outcome = await run({
      config,
      layout: project.layout,
      maxAttempts,
      model: values.model,
      once: Boolean(values.once),
      milestoneId: values.milestone,
      signal: killController.signal,
      stopSignal: stopController.signal,
    });
    return outcome === "complete" || outcome === "stopped" ? 0 : outcome === "blocked" ? 2 : 1;
  }

  fail(`unknown command "${command}"`);
  console.log(USAGE);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
