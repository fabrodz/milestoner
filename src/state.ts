import { readJson, writeJsonAtomic } from "./util/fs.js";
import { iso } from "./util/time.js";
import type { Milestone, MilestoneStatus, RunState } from "./types.js";

const STATUSES: MilestoneStatus[] = ["pending", "in_progress", "done", "blocked"];

function normalizeMilestone(raw: Record<string, unknown>, index: number): Milestone {
  const id = String(raw.id ?? `M${String(index + 1).padStart(2, "0")}`);
  const status = STATUSES.includes(raw.status as MilestoneStatus) ? (raw.status as MilestoneStatus) : "pending";
  // Runs seeded before v0.1 stored evidence as one long string.
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map(String)
    : typeof raw.evidence === "string" && raw.evidence.trim() !== ""
      ? [raw.evidence]
      : [];
  return {
    id,
    title: String(raw.title ?? id),
    prompt: String(raw.prompt ?? `${id}.md`),
    status,
    attempts: Number(raw.attempts ?? 0),
    startedAt: (raw.startedAt as string) ?? null,
    finishedAt: (raw.finishedAt as string) ?? null,
    evidence,
    diagnosis: (raw.diagnosis as Milestone["diagnosis"]) ?? null,
    history: Array.isArray(raw.history) ? (raw.history as Milestone["history"]) : [],
  };
}

export function normalizeState(raw: Record<string, unknown>): RunState {
  const milestones = Array.isArray(raw.milestones) ? raw.milestones : [];
  if (milestones.length === 0) throw new Error("state.json has no milestones");
  return {
    run: String(raw.run ?? "unnamed-run"),
    createdAt: String(raw.createdAt ?? iso()),
    // `mvpComplete` is the flag the reference run used before the field was renamed.
    runComplete: Boolean(raw.runComplete ?? raw.mvpComplete ?? false),
    milestones: milestones.map((m, i) => normalizeMilestone(m as Record<string, unknown>, i)),
  };
}

export function loadState(statePath: string): RunState {
  return normalizeState(readJson<Record<string, unknown>>(statePath));
}

export function saveState(statePath: string, state: RunState): void {
  writeJsonAtomic(statePath, state);
}

export function findMilestone(state: RunState, id: string): Milestone | undefined {
  return state.milestones.find((m) => m.id === id);
}

/** The next milestone the runner should work on: the first that is not done. */
export function nextMilestone(state: RunState): Milestone | undefined {
  return state.milestones.find((m) => m.status !== "done");
}

export function allDone(state: RunState): boolean {
  return state.milestones.every((m) => m.status === "done");
}

export function summarize(state: RunState): { done: number; total: number; blocked: number } {
  return {
    done: state.milestones.filter((m) => m.status === "done").length,
    total: state.milestones.length,
    blocked: state.milestones.filter((m) => m.status === "blocked").length,
  };
}
