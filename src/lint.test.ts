import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate } from "./config.js";
import { lintRun, type LintFinding, type LintInput, type LintMilestone } from "./lint.js";
import { MILESTONE_TEMPLATE } from "./templates/milestone.js";

const RUN = "checkout-v2";

function prompt(id: string): string {
  return `# ${id} - Ship the widget

## Objective

A widget that renders, which the checkout flow needs before M02 can wire it up.

## Tasks

1. Build the widget.

## Acceptance criteria

- **AC1** - the widget renders (evidence: screenshot in \`evidence/${id}.png\`)
- **AC2** - the widget is covered by tests, including the empty-cart case
  (evidence: test count in \`evidence/${id}-test.txt\`)

## Exit

- Committed and tagged \`${RUN}-${id}\`.
`;
}

function milestone(id: string, overrides: Partial<LintMilestone> = {}): LintMilestone {
  return { id, title: "Ship the widget", status: "pending", prompt: `${id}.md`, text: prompt(id), ...overrides };
}

function input(overrides: Partial<LintInput> = {}): LintInput {
  return {
    run: RUN,
    milestones: [milestone("M01")],
    promptFiles: ["M01.md"],
    protocol: `# Execution protocol - run "${RUN}"\n\nThe rules.\n`,
    livenessCount: 1,
    ...overrides,
  };
}

function only(findings: LintFinding[], rule: string): LintFinding[] {
  return findings.filter((f) => f.rule === rule);
}

test("a filled-in run yields no findings at all", () => {
  assert.deepEqual(lintRun(input()), []);
});

test("missing-prompt: a milestone whose prompt file is not on disk", () => {
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text: null })] })), "missing-prompt");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.milestone, "M01");
  assert.equal(findings[0]?.severity, "error");
  assert.equal(findings[0]?.file, ".milestoner/prompts/M01.md");
});

test("missing-prompt: quiet when the prompt text is present", () => {
  assert.deepEqual(only(lintRun(input()), "missing-prompt"), []);
});

test("template-residue: the untouched scaffold triggers it", () => {
  const text = renderTemplate(MILESTONE_TEMPLATE, { id: "M01", title: "TODO: milestone 1 title", run: RUN });
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "template-residue");
  assert.ok(findings.length >= 3, `expected several residue findings, got ${findings.length}`);
  assert.ok(findings.every((f) => f.severity === "error" && f.milestone === "M01"));
  assert.ok(findings.every((f) => typeof f.line === "number"));
});

test("template-residue: a TODO title in state is caught even without a prompt file", () => {
  const findings = lintRun(input({ milestones: [milestone("M01", { title: "TODO: milestone 1 title", text: null })] }));
  const residue = only(findings, "template-residue");
  assert.equal(residue.length, 1);
  assert.equal(residue[0]?.file, ".milestoner/state.json");
});

test("template-residue: a literal ... task item triggers it, a written one does not", () => {
  const text = prompt("M01").replace("1. Build the widget.", "1. ...");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "template-residue");
  assert.equal(findings.length, 1);
  assert.deepEqual(only(lintRun(input()), "template-residue"), []);
});

test("objective-missing: no ## Objective section", () => {
  const text = prompt("M01").replace("## Objective", "## Goal");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "objective-missing");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
});

test("objective-missing: an empty ## Objective section", () => {
  const text = prompt("M01").replace("A widget that renders, which the checkout flow needs before M02 can wire it up.", "");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "objective-missing");
  assert.equal(findings.length, 1);
});

test("objective-missing: quiet when the section has content", () => {
  assert.deepEqual(only(lintRun(input()), "objective-missing"), []);
});

test("criteria-missing: no ## Acceptance criteria section", () => {
  const text = prompt("M01").replace("## Acceptance criteria", "## Checks");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "criteria-missing");
  assert.equal(findings.length, 1);
});

test("criteria-missing: a section with prose but no criterion bullets", () => {
  const text = `# M01 - X\n\n## Objective\n\nA thing.\n\n## Acceptance criteria\n\nIt should work well.\n\n## Exit\n\n- Tagged \`${RUN}-M01\`.\n`;
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "criteria-missing");
  assert.equal(findings.length, 1);
});

test("criteria-missing: quiet when criterion bullets exist", () => {
  assert.deepEqual(only(lintRun(input()), "criteria-missing"), []);
});

test("evidence-missing: a criterion bullet with no evidence note", () => {
  const text = prompt("M01").replace(" (evidence: screenshot in `evidence/M01.png`)", "");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "evidence-missing");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
  assert.equal(typeof findings[0]?.line, "number");
});

test("evidence-missing: an evidence note that names nothing", () => {
  const text = prompt("M01").replace("(evidence: screenshot in `evidence/M01.png`)", "(evidence: ...)");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "evidence-missing");
  assert.equal(findings.length, 1);
});

test("evidence-missing: quiet when the note sits on a continuation line", () => {
  assert.deepEqual(only(lintRun(input()), "evidence-missing"), []);
});

test("exit-missing: no ## Exit section", () => {
  const text = prompt("M01").replace("## Exit", "## Wrap up");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "exit-missing");
  assert.equal(findings.length, 1);
});

test("exit-missing: an ## Exit section that never names the tag", () => {
  const text = prompt("M01").replace(`\`${RUN}-M01\``, "a tag");
  const findings = only(lintRun(input({ milestones: [milestone("M01", { text })] })), "exit-missing");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /checkout-v2-M01/);
});

test("exit-missing: quiet when the tag is mentioned", () => {
  assert.deepEqual(only(lintRun(input()), "exit-missing"), []);
});

test("orphan-prompt: a prompt file no milestone references", () => {
  const findings = only(lintRun(input({ promptFiles: ["M01.md", "M99.md"] })), "orphan-prompt");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.milestone, null);
  assert.equal(findings[0]?.file, ".milestoner/prompts/M99.md");
});

test("orphan-prompt: quiet when every file on disk is referenced", () => {
  assert.deepEqual(only(lintRun(input()), "orphan-prompt"), []);
});

test("protocol-run-mismatch: the header names a different run", () => {
  const findings = only(lintRun(input({ protocol: '# Execution protocol - run "old-run"\n' })), "protocol-run-mismatch");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.match(findings[0]?.message ?? "", /"old-run", not "checkout-v2"/);
});

test("protocol-run-mismatch: the header names no run at all", () => {
  const findings = only(lintRun(input({ protocol: "# My rules\n" })), "protocol-run-mismatch");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /names no run/);
});

test("protocol-run-mismatch: a missing protocol file", () => {
  const findings = only(lintRun(input({ protocol: null })), "protocol-run-mismatch");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /not on disk/);
});

test("protocol-run-mismatch: quiet when the header names this run", () => {
  assert.deepEqual(only(lintRun(input()), "protocol-run-mismatch"), []);
});

test("liveness-empty: zero configured liveness paths", () => {
  const findings = only(lintRun(input({ livenessCount: 0 })), "liveness-empty");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.milestone, null);
  assert.equal(findings[0]?.file, ".milestoner/config.json");
});

test("liveness-empty: quiet when at least one path is configured", () => {
  assert.deepEqual(only(lintRun(input()), "liveness-empty"), []);
});
