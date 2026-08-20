import type { Layout } from "../paths.js";
import { findMilestone, loadState, updateState } from "../state.js";
import { fail, ok, warn } from "../util/log.js";

export interface UnblockOptions {
  layout: Layout;
  milestoneId: string;
  keepAttempts: boolean;
}

/** Clearing a block is a human decision: the engine never resets one on its own. */
export function unblock(options: UnblockOptions): number {
  const preview = findMilestone(loadState(options.layout.state), options.milestoneId);
  if (!preview) {
    fail(`no milestone with id "${options.milestoneId}"`);
    return 1;
  }
  if (preview.status === "done") {
    warn(`${preview.id} is done - nothing to unblock`);
    return 0;
  }

  // Re-read under the lock: the runner may have graded this milestone since the check above.
  const m = findMilestone(
    updateState(options.layout.dir, options.layout.state, (state) => {
      const target = findMilestone(state, options.milestoneId);
      if (!target || target.status === "done") return;
      target.status = "pending";
      target.diagnosis = null;
      if (!options.keepAttempts) target.attempts = 0;
    }),
    options.milestoneId,
  );
  if (!m || m.status === "done") {
    warn(`${options.milestoneId} finished while unblocking it - nothing to do`);
    return 0;
  }
  ok(`${m.id} set to pending${options.keepAttempts ? "" : ", attempts reset to 0"} - run \`dogwatch run\` to resume`);
  return 0;
}
