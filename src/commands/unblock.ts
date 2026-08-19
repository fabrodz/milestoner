import type { Layout } from "../paths.js";
import { findMilestone, loadState, saveState } from "../state.js";
import { fail, ok, warn } from "../util/log.js";

export interface UnblockOptions {
  layout: Layout;
  milestoneId: string;
  keepAttempts: boolean;
}

/** Clearing a block is a human decision: the engine never resets one on its own. */
export function unblock(options: UnblockOptions): number {
  const state = loadState(options.layout.state);
  const m = findMilestone(state, options.milestoneId);
  if (!m) {
    fail(`no milestone with id "${options.milestoneId}"`);
    return 1;
  }
  if (m.status === "done") {
    warn(`${m.id} is done - nothing to unblock`);
    return 0;
  }
  m.status = "pending";
  m.diagnosis = null;
  if (!options.keepAttempts) m.attempts = 0;
  saveState(options.layout.state, state);
  ok(`${m.id} set to pending${options.keepAttempts ? "" : ", attempts reset to 0"} - run \`runpulse run\` to resume`);
  return 0;
}
