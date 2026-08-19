import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { unblock } from "./commands/unblock.js";
import { loadConfig } from "./config.js";
import { findProjectRoot, layoutFor } from "./paths.js";
import { run } from "./runner.js";
import { color, fail, warn } from "./util/log.js";

const USAGE = `
${color.bold("runpulse")} - supervised autonomous-run engine for coding agents

  runpulse init [--run <name>] [--milestones <n>] [--force]
      Scaffold .runpulse/ (config, state machine, protocol, prompt skeletons).

  runpulse run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]
      Drain the run: one fresh agent session per milestone until complete or blocked.

  runpulse status [--json]
      Milestones, attempts, evidence counts, and the pulse (is this run alive?).

  runpulse unblock <id> [--keep-attempts]
      Clear a block after fixing it and set the milestone back to pending.

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
  if (!root) {
    fail("no .runpulse/config.json found here or in any parent directory - run `runpulse init` first");
    return null;
  }
  return { root, layout: layoutFor(root) };
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

  const project = requireProject();
  if (!project) return 1;
  const config = loadConfig(project.layout.config, project.root);

  if (command === "status") {
    return status({ config, layout: project.layout, json: Boolean(values.json) });
  }

  if (command === "unblock") {
    const id = positionals[1];
    if (!id) {
      fail("usage: runpulse unblock <milestoneId> [--keep-attempts]");
      return 1;
    }
    return unblock({ layout: project.layout, milestoneId: id, keepAttempts: Boolean(values["keep-attempts"]) });
  }

  if (command === "run") {
    const controller = new AbortController();
    let interrupts = 0;
    process.on("SIGINT", () => {
      interrupts += 1;
      if (interrupts === 1) {
        warn("\ninterrupt received - stopping after the current session (Ctrl-C again to kill it now)");
        controller.abort();
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
      signal: controller.signal,
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
