import type { Layout } from "../paths.js";
import { createPanel } from "../server/http.js";
import { BIND_HOST, newToken } from "../server/security.js";
import type { DogwatchConfig } from "../types.js";
import { color, fail, info, warn } from "../util/log.js";

export interface ServeOptions {
  config: DogwatchConfig;
  layout: Layout;
  port: number;
  write: boolean;
  token?: string;
}

export function serve(options: ServeOptions): Promise<number> {
  const token = options.token ?? newToken();
  const server = createPanel({
    // argv[1], not import.meta.url: this file is one module inside the bundle, while argv[1] is
    // whatever the user actually invoked - the built CLI, or the entry point under tsx in dev.
    ctx: { config: options.config, layout: options.layout, cliPath: process.argv[1] ?? "" },
    port: options.port,
    token,
    allowWrites: options.write,
  });

  return new Promise((resolve) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      fail(err.code === "EADDRINUSE" ? `port ${options.port} is already in use - pick another with --port` : err.message);
      resolve(1);
    });

    // Loopback only, and not configurable. Everything this panel can do, it does on the machine it
    // runs on, with the permissions of whoever started it.
    server.listen(options.port, BIND_HOST, () => {
      const url = `http://${BIND_HOST}:${options.port}/?token=${token}`;
      console.log(`\n${color.bold("dogwatch panel")}  ${options.write ? color.yellow("read-write") : "read-only"}\n`);
      console.log(`  ${color.bold(url)}\n`);
      if (options.write) {
        warn("  this panel can start runs, kill sessions and run the environment adapter,");
        warn("  which is arbitrary shell. The URL above carries the key: treat it like a password.");
      } else {
        info("  read-only; restart with --write to enable the controls");
      }
      info("  Ctrl-C to stop\n");
    });

    const close = () => {
      server.close();
      resolve(0);
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}
