import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Layout } from "../paths.js";
import type { MilestonerConfig } from "../types.js";
import { color, info, warn } from "../util/log.js";
import { createPanel, type PanelScope } from "./http.js";
import { BIND_HOST, newToken } from "./security.js";

export interface PanelOptions {
  scope: PanelScope;
  port: number;
  write: boolean;
  token?: string;
  /** False when a runner already owns this directory: see D-027. */
  allowStart?: boolean;
  /** What to do when the requested port is taken. */
  onBusy?: "fail" | "ephemeral";
}

/** The scope both project-bound callers build: `serve` and the panel attached to a run. */
export function projectScope(config: MilestonerConfig, layout: Layout): PanelScope {
  // argv[1], not import.meta.url: this file is one module inside the bundle, while argv[1] is
  // whatever the user actually invoked - the built CLI, or the entry point under tsx in dev.
  return { kind: "project", ctx: { config, layout, cliPath: process.argv[1] ?? "" } };
}

export interface PanelHandle {
  url: string;
  port: number;
  token: string;
  write: boolean;
  server: Server;
  close(): Promise<void>;
}

export type PanelStart =
  | { ok: true; panel: PanelHandle; fellBackFrom?: number }
  | { ok: false; code?: string; message: string };

function listenOn(server: Server, port: number): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      resolve(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    // Loopback only, and not configurable. Everything this panel can do, it does on the machine it
    // runs on, with the permissions of whoever started it.
    server.listen(port, BIND_HOST);
  });
}

/** Build the panel, listen, and hand back the URL and a close function. Prints nothing. */
export async function startPanel(options: PanelOptions): Promise<PanelStart> {
  const token = options.token ?? newToken();
  const build = (port: number) =>
    createPanel({
      scope: options.scope,
      port,
      token,
      allowWrites: options.write,
      allowStart: options.allowStart ?? true,
    });

  let server = build(options.port);
  let err = await listenOn(server, options.port);
  let fellBackFrom: number | undefined;

  if (err?.code === "EADDRINUSE" && options.onBusy === "ephemeral") {
    server.close();
    fellBackFrom = options.port;
    server = build(0);
    err = await listenOn(server, 0);
  }
  if (err) return { ok: false, code: err.code, message: err.message };

  const port = (server.address() as AddressInfo).port;
  const panel: PanelHandle = {
    url: `http://${BIND_HOST}:${port}/?token=${token}`,
    port,
    token,
    write: options.write,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // `close` stops new connections; an open server-sent-events stream would otherwise hold the
        // port, and the panel must not outlive the run.
        server.closeAllConnections();
      }),
  };
  return { ok: true, panel, fellBackFrom };
}

export function announcePanel(panel: PanelHandle, closing: string): void {
  console.log(`\n${color.bold("milestoner panel")}  ${panel.write ? color.yellow("read-write") : "read-only"}\n`);
  console.log(`  ${color.bold(panel.url)}\n`);
  if (panel.write) {
    warn("  this panel can start runs, kill sessions and run the environment adapter,");
    warn("  which is arbitrary shell. The URL above carries the key: treat it like a password.");
  } else {
    info("  read-only; restart with --write to enable the controls");
  }
  info(`  ${closing}\n`);
}

/**
 * The panel attached to a run. The run is the point and the panel is the accessory, so nothing here
 * can fail the run: a busy port moves the panel, and a panel that cannot come up at all is a warning.
 */
export async function startRunPanel(options: PanelOptions): Promise<PanelHandle | null> {
  const started = await startPanel({ ...options, allowStart: false, onBusy: "ephemeral" });
  if (!started.ok) {
    warn(`the panel could not start (${started.message}) - the run continues without it`);
    return null;
  }
  if (started.fellBackFrom !== undefined) {
    warn(`port ${started.fellBackFrom} is already in use - the panel is on port ${started.panel.port} instead`);
  }
  announcePanel(started.panel, "it closes when the run ends");
  return started.panel;
}
