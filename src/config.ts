import { readJson } from "./util/fs.js";
import type { AgentConfig, MilestonerConfig } from "./types.js";

export function defaultConfig(run: string, projectRoot: string): MilestonerConfig {
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
    fallbackAgents: [],
    infra: {
      deathSeconds: 90,
      tinyTranscriptBytes: 500,
      crashTranscriptBytes: 100,
      maxRetries: 30,
      usageLimitWaitSeconds: 600,
      genericWaitSeconds: 60,
      usageLimitPatterns: ["session limit", "usage limit", "rate limit", "429"],
      infraFailurePatterns: ["stream disconnected", "connection refused", "econnrefused", "authentication failed", "not logged in"],
    },
    liveness: [],
    environment: { attendCommand: null, attendSeconds: 120 },
  };
}

const REQUIRED = ["run", "agent", "infra"] as const;

export function loadConfig(configPath: string, projectRoot: string): MilestonerConfig {
  const raw = readJson<Partial<MilestonerConfig>>(configPath);
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
    fallbackAgents: (raw.fallbackAgents ?? []).map((a) => ({ ...base.agent, ...a })),
    infra: { ...base.infra, ...raw.infra },
    liveness: raw.liveness ?? base.liveness,
    environment: { ...base.environment, ...raw.environment },
  };
}

/** Substitute {{placeholders}}; an unknown placeholder is left as-is so it is visible in the log. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

export function buildAgentArgs(agent: AgentConfig, vars: Record<string, string>): string[] {
  const args = agent.args.map((a) => renderTemplate(a, vars));
  if (agent.model) {
    args.push(...agent.modelArgs.map((a) => renderTemplate(a, { ...vars, model: agent.model! })));
  }
  return args;
}
