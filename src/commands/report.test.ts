import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { init } from "./init.js";
import { report } from "./report.js";

function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

function scaffoldedReport(): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-report-cli-"));
  assert.equal(quietly(() => init({ projectRoot: root, run: "report-cli", count: 2, force: false })).code, 0);
  const layout = layoutFor(root);
  assert.equal(quietly(() => report({ config: loadConfig(layout.config, root), layout, open: false })), 0);
  return readFileSync(layout.report, "utf8");
}

test("the report a scaffolded run writes says it has not started, and travels on its own", () => {
  const html = scaffoldedReport();

  assert.match(html, /<span class="pill pending">not started yet<\/span>/, "zero sessions is not a run in progress");
  assert.ok(!html.includes("in progress"), "the wording every state of this run gets is its own");
  assert.ok(html.includes("nothing to place on the clock"), "an empty timeline says it is empty");

  assert.ok(!html.includes("back to the panel"), "the file version links to no panel");
  assert.ok(!html.includes("<a href"), "and to nothing else either");
  assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), "no external assets");
  assert.ok(!/<(script|iframe)\b/i.test(html), "no scripts");
});
