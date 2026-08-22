import { relative } from "node:path";
import { appendMilestone } from "../add.js";
import type { Layout } from "../paths.js";
import { info, ok } from "../util/log.js";

export interface AddOptions {
  layout: Layout;
  title?: string;
}

export function add(options: AddOptions): number {
  const added = appendMilestone(options.layout, options.title);
  const rel = relative(options.layout.projectRoot, added.promptPath).replaceAll("\\", "/");
  ok(`${added.id} added as pending - prompt ${rel}`);
  if (!added.promptCreated) info(`${rel} already existed and was kept`);
  if (added.runResumed) info("the run was complete; it has work again - resume with `milestoner run`");
  return 0;
}
