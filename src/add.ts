import { join } from "node:path";
import { renderTemplate } from "./config.js";
import { withStateLock } from "./lock.js";
import type { Layout } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { MILESTONE_TEMPLATE } from "./templates/milestone.js";
import { ensureDir, writeFileIfMissing } from "./util/fs.js";

export interface AddedMilestone {
  id: string;
  title: string;
  promptFile: string;
  promptPath: string;
  /** False when a file with the skeleton's name already existed and was kept. */
  promptCreated: boolean;
  /** True when the run was complete and this append made it a run again. */
  runResumed: boolean;
}

/**
 * Append one pending milestone - next id, title, prompt skeleton - under the state lock, the same
 * way every other mutation goes through. Safe while a runner is alive: the runner picks its next
 * milestone from a fresh state load on every loop pass, so an appended one is simply reached when
 * its turn comes. An existing prompt file with the skeleton's name is kept, because someone may
 * have written the prompt before adding the slot.
 */
export function appendMilestone(layout: Layout, title?: string): AddedMilestone {
  return withStateLock(layout.dir, () => {
    const state = loadState(layout.state);
    const highest = state.milestones.reduce((n, m) => {
      const digits = /(\d+)$/.exec(m.id);
      return digits ? Math.max(n, Number(digits[1])) : n;
    }, 0);
    const id = `M${String(highest + 1).padStart(2, "0")}`;
    const finalTitle = title && title.trim() !== "" ? title.trim() : `TODO: milestone ${highest + 1} title`;
    const promptFile = `${id}.md`;
    const promptPath = join(layout.prompts, promptFile);

    ensureDir(layout.prompts);
    const promptCreated = writeFileIfMissing(promptPath, renderTemplate(MILESTONE_TEMPLATE, { id, title: finalTitle, run: state.run }));

    state.milestones.push({
      id,
      title: finalTitle,
      prompt: promptFile,
      status: "pending",
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      evidence: [],
      diagnosis: null,
      history: [],
    });
    // A completed run that gains a milestone is a run again; a stale flag would make the next
    // runner exit at the top of its loop without ever reaching the new entry.
    const runResumed = state.runComplete;
    state.runComplete = false;
    saveState(layout.state, state);

    return { id, title: finalTitle, promptFile, promptPath, promptCreated, runResumed };
  });
}
