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
    models: {},
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
  return mergeConfig(readJson<Partial<MilestonerConfig>>(configPath), configPath, projectRoot);
}

/**
 * The checks and the defaulting, over a document that need not have come from disk: the panel's
 * config editor validates what was typed into it by running it through exactly this, so a write it
 * accepts is one the next `loadConfig` will accept too. `configPath` only names the file in errors.
 */
export function mergeConfig(raw: Partial<MilestonerConfig>, configPath: string, projectRoot: string): MilestonerConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${configPath}: must be a JSON object`);
  }
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
    models: { ...base.models, ...raw.models },
    infra: { ...base.infra, ...raw.infra },
    liveness: raw.liveness ?? base.liveness,
    environment: { ...base.environment, ...raw.environment },
  };
}

/** Substitute {{placeholders}}; an unknown placeholder is left as-is so it is visible in the log. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

export function buildAgentArgs(agent: AgentConfig, vars: Record<string, string>, model?: string | null): string[] {
  // `null` is a caller saying "no model", not "use the agent's own"; only an absent argument means that.
  const chosen = model === undefined ? agent.model : model;
  const args = agent.args.map((a) => renderTemplate(a, vars));
  if (chosen) {
    args.push(...agent.modelArgs.map((a) => renderTemplate(a, { ...vars, model: chosen })));
  }
  return args;
}

/** The run-level override beats the milestone's entry in `models`, which beats the agent's own. */
export function resolveModel(config: MilestonerConfig, milestoneId: string, override?: string | null): string | null {
  return override ?? config.models[milestoneId] ?? config.agent.model;
}
