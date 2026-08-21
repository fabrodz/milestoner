import { listRuns, type RunHealth, type RunSummary } from "../registry.js";
import { findLivePanel, panelUrl } from "../server/global.js";
import { color, humanDuration } from "../util/log.js";

const GLYPH: Record<RunHealth, string> = {
  alive: color.green("alive   "),
  slow: color.yellow("slow    "),
  hung: color.red("hung    "),
  unknown: color.dim("unknown "),
  gone: color.red("gone    "),
  complete: color.green("complete"),
};

const EXPLAIN: Record<RunHealth, string> = {
  alive: "",
  slow: "no engine event for a while",
  hung: "the runner has not logged an event in over 25m",
  unknown: "registered, but the pulse says nothing about when it last moved",
  gone: "the runner is not running; relaunch it with `milestoner run` in that directory",
  complete: "",
};

function line(r: RunSummary): string {
  const progress = `${r.done}/${r.total}`.padEnd(6);
  const where = r.milestoneId ? r.milestoneId.padEnd(5) : "-".padEnd(5);
  const attempt = r.attempt ? color.dim(` att ${r.attempt}`) : "";
  const blocked = r.blocked > 0 ? color.red(` ${r.blocked} blocked`) : "";
  return `  ${GLYPH[r.health]}  ${color.bold(r.run.padEnd(18))} ${where} ${progress}${blocked}  ${color.dim(`pid ${r.pid}`)}${attempt}`;
}

export interface RunsOptions {
  registry: string;
  json: boolean;
}

/**
 * The one command that does not need a project: it answers "what is running on this machine" from
 * anywhere, which is the whole reason the registry exists.
 */
export async function runs(options: RunsOptions): Promise<number> {
  const listing = listRuns(options.registry);
  const needsYou = listing.runs.filter((r) => r.blocked > 0 || r.health === "gone");
  const panel = await findLivePanel();

  if (options.json) {
    console.log(
      JSON.stringify(
        { registry: listing.file, panel: panel ? panelUrl(panel) : null, runs: listing.runs, pruned: listing.pruned },
        null,
        2,
      ),
    );
    return needsYou.length > 0 ? 2 : 0;
  }

  console.log(`\n${color.bold("milestoner runs")}  ${listing.runs.length} registered`);
  console.log(color.dim(`  ${listing.file}`));
  if (panel) console.log(`  ${color.dim("panel")} ${color.bold(panelUrl(panel))}`);
  console.log("");

  if (listing.runs.length === 0) {
    console.log(`  ${color.dim("no runs registered on this machine")} - start one with ${color.bold("milestoner run")}`);
  }

  for (const r of listing.runs) {
    console.log(line(r));
    console.log(`         ${color.dim(r.projectRoot)}`);
    const seen = Date.now() - Date.parse(r.lastSeen);
    const age = r.health === "gone" && Number.isFinite(seen) ? `last seen ${humanDuration(seen)} ago` : "";
    const note = [EXPLAIN[r.health], age].filter(Boolean).join(" - ");
    if (note) console.log(`         ${color.yellow(note)}`);
  }

  for (const p of listing.pruned) {
    const why = p.reason === "project-gone" ? "its .milestoner directory is gone" : "its runner ended over a day ago";
    console.log(`  ${color.dim(`pruned ${p.run} (${p.projectRoot}): ${why}`)}`);
  }

  console.log("");
  return needsYou.length > 0 ? 2 : 0;
}
