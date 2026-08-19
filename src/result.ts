import { renameSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, readJsonIfExists, removeIfExists } from "./util/fs.js";
import type { Diagnosis, MilestoneResult } from "./types.js";

export interface Verdict {
  outcome: "done" | "blocked" | "incomplete";
  evidence: string[];
  diagnosis: Diagnosis | null;
  notes: string;
  /** Why the engine downgraded or questioned what the session claimed. */
  warnings: string[];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}

function asDiagnosis(value: unknown): Diagnosis | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const symptom = String(d.symptom ?? "").trim();
  const userAction = String(d.userAction ?? "").trim();
  if (!symptom || !userAction) return null;
  return { symptom, tried: asStringArray(d.tried), userAction };
}

/**
 * Grade what the session claimed. A milestone is done when its acceptance criteria have
 * written evidence, not when the session says so, so "done" with no evidence is a retry.
 */
export function gradeResult(raw: MilestoneResult | null, milestoneId: string): Verdict {
  const warnings: string[] = [];
  if (!raw) {
    return { outcome: "incomplete", evidence: [], diagnosis: null, notes: "", warnings: ["no result.json written"] };
  }
  if (raw.milestone && raw.milestone !== milestoneId) {
    warnings.push(`result.json is for "${raw.milestone}", expected "${milestoneId}" - ignored`);
    return { outcome: "incomplete", evidence: [], diagnosis: null, notes: "", warnings };
  }

  const evidence = asStringArray(raw.evidence);
  const diagnosis = asDiagnosis(raw.diagnosis);
  const notes = String(raw.notes ?? "").trim();

  if (raw.status === "done") {
    if (evidence.length === 0) {
      warnings.push('claimed "done" with no evidence - downgraded to incomplete');
      return { outcome: "incomplete", evidence, diagnosis, notes, warnings };
    }
    return { outcome: "done", evidence, diagnosis: null, notes, warnings };
  }

  if (raw.status === "blocked") {
    // Still a stop: retrying a real block burns attempts. Flag it loudly instead.
    if (!diagnosis) warnings.push('claimed "blocked" without a diagnosis (symptom + userAction)');
    return { outcome: "blocked", evidence, diagnosis, notes, warnings };
  }

  if (raw.status !== "incomplete") warnings.push(`unknown status "${String(raw.status)}" - treated as incomplete`);
  return { outcome: "incomplete", evidence, diagnosis, notes, warnings };
}

export function readResult(resultPath: string): MilestoneResult | null {
  return readJsonIfExists<MilestoneResult>(resultPath);
}

/** Move the drop box into results/ so every attempt keeps its own raw claim. */
export function archiveResult(resultPath: string, resultsDir: string, milestoneId: string, attempt: number): void {
  ensureDir(resultsDir);
  const target = join(resultsDir, `${milestoneId}-attempt${attempt}.json`);
  try {
    renameSync(resultPath, target);
  } catch {
    removeIfExists(resultPath);
  }
}
