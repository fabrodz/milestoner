export type MilestoneStatus = "pending" | "in_progress" | "done" | "blocked";

export interface Diagnosis {
  symptom: string;
  tried: string[];
  userAction: string;
}

export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  endedAt: string;
  seconds: number;
  exitCode: number | null;
  transcript: string;
  outcome: "done" | "blocked" | "incomplete" | "infra-failure";
  detail?: string;
  /** First line of the steering in force when this attempt launched, if any. */
  steering?: string;
  /** Which agent ran it. Without this a run that rotated agents cannot be read back. */
  agent?: string;
}

export interface Milestone {
  id: string;
  title: string;
  prompt: string;
  status: MilestoneStatus;
  attempts: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  evidence: string[];
  diagnosis?: Diagnosis | null;
  history: AttemptRecord[];
}

export interface RunState {
  run: string;
  createdAt: string;
  runComplete: boolean;
  /** Bumped on every write. Lets a reader tell "nothing changed" from "changed back". */
  rev: number;
  milestones: Milestone[];
}

export interface AgentConfig {
  /** Shown in logs, the attempt history and the report. Defaults to the command. */
  name?: string;
  /** Executable to spawn. The whole invocation is a config string from day one so a
   *  second agent (Cursor, Codex) only needs a config change, not an engine change. */
  command: string;
  /** Argument template. Placeholders: {{kickoff}} {{promptFile}} {{milestoneId}} {{projectRoot}} {{milestonerDir}} {{model}} */
  args: string[];
  /** Extra args appended only when `model` is set. */
  modelArgs: string[];
  model: string | null;
  env: Record<string, string>;
}

export interface InfraConfig {
  /** A session dying faster than this with a tiny transcript is infrastructure, not work. */
  deathSeconds: number;
  tinyTranscriptBytes: number;
  maxRetries: number;
  usageLimitWaitSeconds: number;
  genericWaitSeconds: number;
  /** Case-insensitive substrings that mark a usage/rate limit in the transcript. */
  usageLimitPatterns: string[];
  /**
   * Case-insensitive substrings that mark an agent or backend failure which is not a usage limit:
   * a model endpoint that never answered, an expired login, a dropped stream. Same refund as a
   * usage limit, but the short wait: there is no announced reset to sit out.
   */
  infraFailurePatterns: string[];
}

export interface MilestonerConfig {
  run: string;
  projectRoot: string;
  maxAttempts: number;
  retryDelaySeconds: number;
  agent: AgentConfig;
  /**
   * Tried in order when `agent` is unavailable: out of quota, or failing for a reason the infra
   * rules recognise. Empty means the runner waits the limit out instead, which is the old behaviour.
   */
  fallbackAgents: AgentConfig[];
  infra: InfraConfig;
  /** Paths (relative to projectRoot) whose mtime proves the run is alive. The transcript
   *  is never one: headless sessions flush it only at exit. */
  liveness: string[];
  environment: EnvironmentConfig;
}

export interface EnvironmentConfig {
  /**
   * The environment adapter: a command that unsticks a host-bound environment (refocus a window,
   * dismiss a native modal, restart a tool server). Run by `milestoner attend`, which is the only
   * environment intervention the supervisor is allowed to make. `{{seconds}}` is substituted.
   */
  attendCommand: string | null;
  attendSeconds: number;
}

export interface MilestoneResult {
  milestone: string;
  status: "done" | "blocked" | "incomplete";
  evidence?: string[];
  diagnosis?: Diagnosis | null;
  notes?: string;
}

export interface Pulse {
  pid: number;
  run: string;
  startedAt: string;
  milestoneId: string | null;
  attempt: number | null;
  sessionStartedAt: string | null;
  /** The agent process, so a supervisor can kill a hung session without touching the runner. */
  agentPid: number | null;
  /** Name of the agent currently in use, when the run has fallbacks configured. */
  agent?: string | null;
  transcript: string | null;
  lastEvent: string;
  lastEventAt: string;
}

/** Written by `milestoner kill` so the runner grades a deliberate kill as work, not infrastructure. */
export interface KillMarker {
  milestoneId: string;
  agentPid: number;
  at: string;
  reason: string;
}
