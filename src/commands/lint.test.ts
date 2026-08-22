import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import type { LintFinding } from "../lint.js";
import { layoutFor } from "../paths.js";
import { init } from "./init.js";
import { lint } from "./lint.js";

// Colour depends on whether stdout is a tty, which is not the same when the file is run on its own.
const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");

function capture(fn: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { code: fn(), out: plain(lines.join("\n")) };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function scaffold(run: string): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-lint-"));
  const first = capture(() => init({ projectRoot: root, run, count: 2, force: false }).code);
  assert.equal(first.code, 0, "the scaffold must succeed");
  return root;
}

function lintAt(root: string, json = false): { code: number; out: string } {
  const layout = layoutFor(root);
  return capture(() => lint({ config: loadConfig(layout.config, root), layout, json }));
}

function goodPrompt(run: string, id: string): string {
  return `# ${id} - Ship the widget

## Objective

A widget that renders, which the run needs before the next milestone can wire it up.

## Tasks

1. Build the widget.

## Acceptance criteria

- **AC1** - the widget renders (evidence: screenshot in \`evidence/${id}.png\`)

## Exit

- Committed and tagged \`${run}-${id}\`.
`;
}

function fillIn(root: string, run: string, { liveness = true } = {}): void {
  const layout = layoutFor(root);
  const state = JSON.parse(readFileSync(layout.state, "utf8")) as { milestones: { id: string; prompt: string; title: string }[] };
  for (const m of state.milestones) {
    m.title = "Ship the widget";
    writeFileSync(join(layout.prompts, m.prompt), goodPrompt(run, m.id));
  }
  writeFileSync(layout.state, JSON.stringify(state));
  if (liveness) {
    const config = JSON.parse(readFileSync(layout.config, "utf8")) as Record<string, unknown>;
    config.liveness = ["src"];
    writeFileSync(layout.config, JSON.stringify(config));
  }
}

test("a run straight out of init fails with template-residue errors, grouped per milestone", () => {
  const root = scaffold("checkout-v2");
  const { code, out } = lintAt(root);

  assert.equal(code, 1);
  assert.match(out, /template-residue/);
  assert.match(out, /error/);
  assert.match(out, /\.milestoner\/prompts\/M01\.md/);
  assert.match(out, /\d+ errors, \d+ warnings?/);
  const runHeader = out.indexOf('run "checkout-v2"');
  assert.ok(runHeader >= 0, "run-level findings get their own group");
  assert.ok(runHeader < out.indexOf("M01"), "run-level findings come first");
  assert.ok(out.indexOf("M01") < out.indexOf("M02"), "milestones keep state order");
});

test("the same run with prompts written in passes with an explicit all-clear", () => {
  const root = scaffold("checkout-v2");
  fillIn(root, "checkout-v2");
  const { code, out } = lintAt(root);

  assert.equal(code, 0);
  assert.match(out, /all clear/);
  assert.match(out, /0 errors, 0 warnings/);
});

test("warnings alone exit 0", () => {
  const root = scaffold("checkout-v2");
  fillIn(root, "checkout-v2", { liveness: false });
  const { code, out } = lintAt(root);

  assert.equal(code, 0, "a warning is worth knowing about, never worth failing a script");
  assert.match(out, /warning\s+liveness-empty/);
  assert.match(out, /0 errors, 1 warning\b/);
});

test("orphan-model: a models key naming no milestone warns, a map that names one is quiet", () => {
  const root = scaffold("checkout-v2");
  fillIn(root, "checkout-v2");
  const layout = layoutFor(root);
  const config = JSON.parse(readFileSync(layout.config, "utf8")) as Record<string, unknown>;

  config.models = { M02: "opus", M99: "opus" };
  writeFileSync(layout.config, JSON.stringify(config));
  const orphaned = lintAt(root);
  assert.equal(orphaned.code, 0, "a model nobody uses is never worth refusing a start over");
  assert.match(orphaned.out, /warning\s+orphan-model/);
  assert.match(orphaned.out, /models\."M99"/);
  assert.match(orphaned.out, /0 errors, 1 warning\b/);

  config.models = { M02: "opus" };
  writeFileSync(layout.config, JSON.stringify(config));
  assert.match(lintAt(root).out, /all clear/);
});

test("--json emits { run, errors, warnings, findings } with counts that match the findings", () => {
  const root = scaffold("checkout-v2");
  const { code, out } = lintAt(root, true);
  const parsed = JSON.parse(out) as { run: string; errors: number; warnings: number; findings: LintFinding[] };

  assert.equal(code, 1);
  assert.equal(parsed.run, "checkout-v2");
  assert.ok(parsed.errors > 0);
  assert.equal(parsed.findings.filter((f) => f.severity === "error").length, parsed.errors);
  assert.equal(parsed.findings.filter((f) => f.severity === "warning").length, parsed.warnings);
  const f = parsed.findings[0];
  assert.ok(f && typeof f.rule === "string" && typeof f.message === "string" && typeof f.file === "string");
});

test("--json on a clean run: empty findings, exit 0", () => {
  const root = scaffold("checkout-v2");
  fillIn(root, "checkout-v2");
  const { code, out } = lintAt(root, true);
  const parsed = JSON.parse(out) as { errors: number; warnings: number; findings: LintFinding[] };

  assert.equal(code, 0);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.warnings, 0);
  assert.deepEqual(parsed.findings, []);
});

test("no run to lint: a missing state.json exits 1 with a clear message", () => {
  const root = scaffold("checkout-v2");
  rmSync(layoutFor(root).state);
  const { code, out } = lintAt(root);

  assert.equal(code, 1);
  assert.match(out, /no run to lint/);
  assert.match(out, /state\.json/);
});
