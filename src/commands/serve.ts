import type { Layout } from "../paths.js";
import { announcePanel, startPanel } from "../server/panel.js";
import type { MilestonerConfig } from "../types.js";
import { fail } from "../util/log.js";

export interface ServeOptions {
  config: MilestonerConfig;
  layout: Layout;
  port: number;
  write: boolean;
  token?: string;
}

export async function serve(options: ServeOptions): Promise<number> {
  const started = await startPanel({
    config: options.config,
    layout: options.layout,
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
