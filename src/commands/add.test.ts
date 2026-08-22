import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { loadState } from "../state.js";
import { add } from "./add.js";
import { init } from "./init.js";
import { status } from "./status.js";

function capture<T>(fn: () => T): { value: T; lines: string[] } {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { value: fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("milestoner add round-trips on a fixture project and status shows the new milestone", () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-add-cli-"));
  assert.equal(capture(() => init({ projectRoot: root, run: "add-cli", count: 2, force: false })).value.code, 0);
  const layout = layoutFor(root);

  const first = capture(() => add({ layout }));
  assert.equal(first.value, 0, "add exits 0");
  const printed = first.lines.join("\n");
  assert.match(printed, /M03/, "the new id is printed");
  assert.match(printed, /\.milestoner\/prompts\/M03\.md/, "and so is the prompt path");

  const state = loadState(layout.state);
  assert.equal(state.milestones.length, 3);
  assert.equal(state.milestones.at(-1)?.status, "pending");
  assert.ok(existsSync(join(layout.prompts, "M03.md")), "the skeleton is on disk");

  const titled = capture(() => add({ layout, title: "a named milestone" }));
  assert.equal(titled.value, 0);
  assert.match(titled.lines.join("\n"), /M04/);
  assert.equal(loadState(layout.state).milestones.at(-1)?.title, "a named milestone");

  const config = loadConfig(layout.config, root);
  const shown = capture(() => status({ config, layout, json: true }));
  assert.equal(shown.value, 0);
  const view = JSON.parse(shown.lines.join("\n")) as { total: number; milestones: Array<{ id: string; status: string }> };
  assert.equal(view.total, 4);
  assert.deepEqual(
    view.milestones.map((m) => m.id),
    ["M01", "M02", "M03", "M04"],
    "status reads the appended milestones back in order",
  );
  assert.equal(view.milestones.at(-1)?.status, "pending");
});
