import { readJson } from "./util/fs.js";
import type { RunpulseConfig } from "./types.js";

export function defaultConfig(run: string, projectRoot: string): RunpulseConfig {
  return {
    run,
    projectRoot,
    maxAttempts: 3,
    retryDelaySeconds: 15,
    agent: {
      command: "claude",
      args: ["-p", "{{kickoff}}", "--dangerously-skip-permissions"],
      modelArgs: ["--model", "{{model}}"],
      model: null,
      env: {},
    },
    infra: {
      deathSeconds: 90,
      tinyTranscriptBytes: 500,
      maxRetries: 30,
      usageLimitWaitSeconds: 600,
      genericWaitSeconds: 60,
      usageLimitPatterns: ["session limit", "usage limit", "rate limit", "429"],
    },
    liveness: [],
  };
}

const REQUIRED = ["run", "agent", "infra"] as const;

export function loadConfig(configPath: string, projectRoot: string): RunpulseConfig {
  const raw = readJson<Partial<RunpulseConfig>>(configPath);
  for (const key of REQUIRED) {
    if (raw[key] === undefined) throw new Error(`${configPath}: missing required field "${key}"`);
  }
  const base = defaultConfig(String(raw.run), projectRoot);
  return {
    ...base,
    ...raw,
    run: String(raw.run),
    projectRoot,
    agent: { ...base.agent, ...raw.agent },
    infra: { ...base.infra, ...raw.infra },
    liveness: raw.liveness ?? base.liveness,
  };
}

/** Substitute {{placeholders}}; an unknown placeholder is left as-is so it is visible in the log. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

export function buildAgentArgs(config: RunpulseConfig, vars: Record<string, string>): string[] {
  const args = config.agent.args.map((a) => renderTemplate(a, vars));
  if (config.agent.model) {
    args.push(...config.agent.modelArgs.map((a) => renderTemplate(a, { ...vars, model: config.agent.model! })));
  }
  return args;
}
