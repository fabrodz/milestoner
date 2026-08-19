import { readFileSync } from "node:fs";

/** Injecting more than this into a kickoff crowds out the milestone prompt itself. */
export const STEERING_LIMIT = 4000;

export interface Steering {
  text: string;
  /** First non-empty, non-heading line: what shows up in logs and the report. */
  headline: string;
  truncated: boolean;
}

function stripComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, "");
}

export function parseSteering(raw: string): Steering | null {
  const text = stripComments(raw).trim();
  if (text === "") return null;
  const headline =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "" && !l.startsWith("#")) ?? text.slice(0, 80);
  return {
    text: text.length > STEERING_LIMIT ? `${text.slice(0, STEERING_LIMIT)}\n[...truncated]` : text,
    headline: headline.length > 120 ? `${headline.slice(0, 117)}...` : headline,
    truncated: text.length > STEERING_LIMIT,
  };
}

/**
 * Steering persists until the user clears it: an overnight correction that applied to one
 * milestone and then silently vanished would be worse than no channel at all. Every attempt
 * records the headline that was in force, so it is always visible which sessions saw it.
 */
export function readSteering(steeringPath: string): Steering | null {
  try {
    return parseSteering(readFileSync(steeringPath, "utf8"));
  } catch {
    return null;
  }
}
