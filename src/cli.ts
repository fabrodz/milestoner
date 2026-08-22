import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { attend } from "./commands/attend.js";
import { init } from "./commands/init.js";
import { kill } from "./commands/kill.js";
import { lint } from "./commands/lint.js";
import { report } from "./commands/report.js";
import { runs } from "./commands/runs.js";
import { serve, serveAll } from "./commands/serve.js";
import { installSkill } from "./commands/skill.js";
import { steer } from "./commands/steer.js";
import { status } from "./commands/status.js";
import { unblock } from "./commands/unblock.js";
import { loadConfig } from "./config.js";
import { MILESTONER_DIR, findLegacyRoot, findProjectRoot, layoutFor, projectsPath, registryPath } from "./paths.js";
import { recordProject } from "./projects.js";
import { run } from "./runner.js";
import { color, fail, warn } from "./util/log.js";

const USAGE = `
${color.bold("milestoner")} - supervised autonomous-run engine for coding agents

  milestoner init [--run <name>] [--milestones <n>] [--force]
      Scaffold .milestoner/ (config, state machine, protocol, prompt skeletons).

  milestoner lint [--json]
      Check the run's form before a session spends time on it: milestone prompts,
      protocol and config. Exits 1 only on error-severity findings; warnings alone
      exit 0.

  milestoner run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]
                 [--no-lint] [--no-panel] [--open | --no-open]
                 [--serve [--port <n>] [--write]]
      Drain the run: one fresh agent session per milestone until complete or blocked.
      Lints the run first and refuses to start on error-level findings on pending
      milestones; --no-lint skips the gate (the findings are still logged).
      Unless --no-panel, the machine panel comes up with the first run on this machine,
      spans every run, and stays while any run is alive; each run prints its URL, and
      the run that starts it opens the browser (--open forces that, --no-open stops it).
      --serve instead attaches a panel for this run only, closed when the run ends.

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

  milestoner serve [--all] [--port <n>] [--write] [--token <key>]
      Local web panel. Binds 127.0.0.1 only and prints a URL carrying a one-time key.
      --write enables the controls; without it the panel only reads. --all serves every
      run registered on this machine - the same panel "run" brings up on its own - and
      works from any directory.

  milestoner skill install [<name>] [-g|--global] [--force] [--print]
      Install the bundled skills into .claude/skills/ (--global: ~/.claude/skills/).
      With no name, installs all of them: supervisor, planner. --print needs a name.

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

function panelPort(raw: string | undefined): number | null {
  const port = raw ? Number(raw) : 4400;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("--port must be an integer between 1 and 65535");
    return null;
  }
  return port;
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
      global: { type: "boolean", short: "g" },
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
      serve: { type: "boolean" },
      all: { type: "boolean" },
      "auto-exit": { type: "boolean" },
      "no-lint": { type: "boolean" },
      "no-panel": { type: "boolean" },
      "no-open": { type: "boolean" },
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
    const projectRoot = resolve(process.cwd());
    const { code } = init({ projectRoot, run: values.run, count, force: Boolean(values.force) });
    if (code === 0) recordProject(projectsPath(), projectRoot);
    return code;
  }

  if (command === "skill") {
    const action = positionals[1] ?? "install";
    if (action !== "install") {
      fail(`unknown skill action "${action}" - the only action is "install"`);
      return 1;
    }
    return installSkill({
      projectRoot: findProjectRoot() ?? resolve(process.cwd()),
      name: positionals[2],
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

  // Same reason: the machine panel spans projects, so it must not require standing in one.
  if (command === "serve" && values.all) {
    const port = panelPort(values.port);
    if (port === null) return 1;
    return serveAll({ port, write: Boolean(values.write), token: values.token, autoExit: Boolean(values["auto-exit"]) });
  }

  const project = requireProject();
  if (!project) return 1;
  // Every project-scoped command passes here, and every one of them is proof that a person works in
  // this directory. Best-effort by construction, so a machine dir that cannot be written costs the
  // panel a listing and this command nothing.
  recordProject(projectsPath(), project.root);
  const config = loadConfig(project.layout.config, project.root);

  if (command === "status") {
    return status({ config, layout: project.layout, json: Boolean(values.json) });
  }

  if (command === "lint") {
    return lint({ config, layout: project.layout, json: Boolean(values.json) });
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
    const port = panelPort(values.port);
    if (port === null) return 1;
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
    let serveOptions: { port: number; write: boolean; token?: string } | undefined;
    if (values.serve) {
      // The panel URL carries the run's key, and a browser writes what it opens into its history and
      // into whatever it syncs. Copying the URL is one keystroke more and leaks nothing. See D-027.
      if (values.open) {
        fail("--open is not offered with --serve: the panel URL carries this run's key, and handing it to the browser writes a live credential into its history - copy the URL the run prints instead");
        return 1;
      }
      const port = panelPort(values.port);
      if (port === null) return 1;
      serveOptions = { port, write: Boolean(values.write), token: values.token };
    }

    let globalPanel: { cliPath: string; port: number; write: boolean; open: "auto" | "always" | "never" } | undefined;
    if (values["no-panel"] || values.serve) {
      // --serve pins a panel to this run; running the machine panel beside it would be two panels
      // saying the same thing. --open belongs to the machine panel, whose /auth exchange keeps the
      // key out of the browser (D-032) - the attached panel has no such door, see D-027 above.
      if (values.open && values["no-panel"]) {
        fail("--open opens the machine panel, which --no-panel turns off - drop one of the two");
        return 1;
      }
    } else {
      const port = panelPort(values.port);
      if (port === null) return 1;
      globalPanel = {
        cliPath: process.argv[1] ?? "",
        port,
        write: true,
        open: values["no-open"] ? "never" : values.open ? "always" : "auto",
      };
    }

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
      noLint: Boolean(values["no-lint"]),
      signal: killController.signal,
      stopSignal: stopController.signal,
      serve: serveOptions,
      globalPanel,
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
