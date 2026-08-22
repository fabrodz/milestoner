import type { Layout } from "../paths.js";
import { projectsPath, registryPath } from "../paths.js";
import { hasLiveRunner } from "../registry.js";
import { claimPanel, findLivePanel, panelUrl, releasePanel, type PanelInfo } from "../server/global.js";
import { announcePanel, projectScope, startPanel } from "../server/panel.js";
import type { MilestonerConfig } from "../types.js";
import { fail, info } from "../util/log.js";
import { iso } from "../util/time.js";

export interface ServeOptions {
  config: MilestonerConfig;
  layout: Layout;
  port: number;
  write: boolean;
  token?: string;
}

export async function serve(options: ServeOptions): Promise<number> {
  const started = await startPanel({
    scope: projectScope(options.config, options.layout),
    port: options.port,
    write: options.write,
    token: options.token,
    onBusy: "fail",
  });

  if (!started.ok) {
    fail(started.code === "EADDRINUSE" ? `port ${options.port} is already in use - pick another with --port` : started.message);
    return 1;
  }

  const { panel } = started;
  announcePanel(panel, "Ctrl-C to stop");

  return new Promise((resolve) => {
    panel.server.on("error", (err: NodeJS.ErrnoException) => {
      fail(err.message);
      resolve(1);
    });

    const close = () => {
      void panel.close();
      resolve(0);
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}

export interface ServeAllOptions {
  port: number;
  write: boolean;
  token?: string;
  /** Daemon mode: exit once no run on the machine has been alive for LINGER_MS. */
  autoExit: boolean;
}

const POLL_MS = 5_000;

/**
 * Long enough to read how a run ended and to relaunch it from the browser - the panel's start
 * control is exactly what a grace period keeps reachable between two runs.
 */
export const LINGER_MS = 10 * 60 * 1000;

/**
 * The machine panel: one server for every run the registry knows about. Foreground it is a command
 * like `serve`; with --auto-exit it is the daemon a run spawns, which stays while runs are alive
 * and cleans up after itself. See D-032.
 */
export async function serveAll(options: ServeAllOptions): Promise<number> {
  const registry = registryPath();
  const started = await startPanel({
    scope: { kind: "machine", registry, projects: projectsPath(), cliPath: process.argv[1] ?? "" },
    port: options.port,
    write: options.write,
    token: options.token,
    // The daemon must come up wherever it can; the command fails loudly like `serve` does.
    onBusy: options.autoExit ? "ephemeral" : "fail",
  });

  if (!started.ok) {
    fail(started.code === "EADDRINUSE" ? `port ${options.port} is already in use - pick another with --port` : started.message);
    return 1;
  }
  const { panel } = started;

  const mine: PanelInfo = { pid: process.pid, port: panel.port, token: panel.token, startedAt: iso() };
  if (!(await claimPanel(mine))) {
    // Two runs starting at once spawn two daemons; the loser leaves quietly and the winner serves.
    await panel.close();
    if (options.autoExit) return 0;
    const other = await findLivePanel();
    fail(`a machine panel is already running${other ? ` - open ${panelUrl(other)}` : ""}`);
    return 1;
  }

  announcePanel(
    panel,
    options.autoExit ? "it closes itself once no run has been alive for 10 minutes" : "Ctrl-C to stop",
  );
  info(`  serving every run registered in ${registry}\n`);

  return new Promise((resolve) => {
    let lastAlive = Date.now();
    let timer: NodeJS.Timeout | null = null;

    const close = (code: number) => {
      if (timer) clearInterval(timer);
      releasePanel(process.pid);
      void panel.close();
      resolve(code);
    };

    if (options.autoExit) {
      timer = setInterval(() => {
        if (hasLiveRunner(registry)) lastAlive = Date.now();
        else if (Date.now() - lastAlive > LINGER_MS) close(0);
      }, POLL_MS);
    }

    panel.server.on("error", (err: NodeJS.ErrnoException) => {
      fail(err.message);
      close(1);
    });
    process.on("SIGINT", () => close(0));
    process.on("SIGTERM", () => close(0));
  });
}
