import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";
import type { Layout } from "../paths.js";
import { buildReport } from "../report.js";
import { loadState } from "../state.js";
import type { DogwatchConfig } from "../types.js";
import { ensureDir } from "../util/fs.js";
import { dirname } from "node:path";
import { color, info, ok } from "../util/log.js";

export interface ReportOptions {
  config: DogwatchConfig;
  layout: Layout;
  out?: string;
  open: boolean;
}

function readLines(file: string, max: number): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("`"))
      .slice(-max);
  } catch {
    return [];
  }
}

export function report(options: ReportOptions): number {
  const state = loadState(options.layout.state);
  const html = buildReport({
    state,
    maxAttempts: options.config.maxAttempts,
    runLog: readLines(options.layout.runLog, 200),
    supervisorLog: readLines(options.layout.supervisorLog, 100),
    generatedAt: new Date(),
  });

  const out = options.out ? resolve(process.cwd(), options.out) : options.layout.report;
  ensureDir(dirname(out));
  writeFileSync(out, html, "utf8");

  ok(`wrote ${relative(process.cwd(), out) || out} (${Math.round(html.length / 1024)} KB, self-contained)`);
  if (options.open) {
    const [cmd, args] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", out]]
        : process.platform === "darwin"
          ? ["open", [out]]
          : ["xdg-open", [out]];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } else {
    info(`  open it with ${color.bold("dogwatch report --open")}`);
  }
  return 0;
}
