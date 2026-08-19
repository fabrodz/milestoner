import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, escapeHtml } from "./report.js";
import { normalizeState } from "./state.js";

const state = normalizeState({
  run: "demo-run",
  createdAt: "2026-08-18T20:00:00.000Z",
  runComplete: false,
  milestones: [
    {
      id: "M01",
      title: "Domain model",
      status: "done",
      attempts: 1,
      evidence: ["AC1: 42 tests green in results/latest.txt"],
      finishedAt: "2026-08-18T21:00:00.000Z",
      history: [
        {
          attempt: 1,
          startedAt: "2026-08-18T20:00:00.000Z",
          endedAt: "2026-08-18T20:20:00.000Z",
          seconds: 1200,
          exitCode: 1,
          transcript: "logs/M01-a.log",
          outcome: "infra-failure",
          detail: "usage-limit",
        },
        {
          attempt: 1,
          startedAt: "2026-08-18T20:40:00.000Z",
          endedAt: "2026-08-18T21:00:00.000Z",
          seconds: 1200,
          exitCode: 0,
          transcript: "logs/M01-b.log",
          outcome: "done",
          steering: "prefer the simpler fix",
        },
      ],
    },
    {
      id: "M02",
      title: "Blocked one",
      status: "blocked",
      attempts: 2,
      evidence: [],
      diagnosis: { symptom: "port 5173 busy", tried: ["restart"], userAction: "free port 5173" },
      history: [],
    },
  ],
});

test("agent-authored text cannot inject markup into the report", () => {
  const hostile = normalizeState({
    run: "x",
    milestones: [
      {
        id: "M01",
        title: "<script>alert(1)</script>",
        status: "done",
        evidence: ['AC1: compared a < b && c > d with "quotes"'],
        history: [],
      },
    ],
  });
  const html = buildReport({ state: hostile, runLog: ["<img onerror=x>"], supervisorLog: [], generatedAt: new Date(0) });

  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img onerror=x>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("a &lt; b &amp;&amp; c &gt; d"));
});

test("escapeHtml covers every character that can break out of markup or an attribute", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});

test("the report carries the facts that make a run auditable", () => {
  const html = buildReport({
    state,
    runLog: ["2026-08-18T20:00:00Z | M01 | launch | attempt 1/3"],
    supervisorLog: ["2026-08-18T20:30:00Z | rule 4 | kill agent | killed"],
    generatedAt: new Date("2026-08-18T21:30:00.000Z"),
  });

  assert.ok(html.includes("demo-run"));
  assert.ok(html.includes("AC1: 42 tests green"));
  assert.ok(html.includes("free port 5173"), "the blocked milestone's user action must be visible");
  assert.ok(html.includes("blocked at M02"), "an unfinished run is titled by its block");
  assert.ok(html.includes("prefer the simpler fix"), "steering in force is part of the audit trail");
  assert.ok(html.includes("rule 4"), "interventions belong in the report");
  assert.ok(/1 infrastructure retry \(not charged\)/.test(html));
});

test("the report is self-contained", () => {
  const html = buildReport({ state, runLog: [], supervisorLog: [], generatedAt: new Date(0) });
  assert.ok(!/<(script|iframe)\b/i.test(html), "no scripts");
  assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), "no external assets");
});

test("timeline segments stay inside the track", () => {
  const html = buildReport({ state, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-18T21:30:00.000Z") });
  for (const [, left, width] of html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)) {
    assert.ok(Number(left) + Number(width) <= 100.01, `segment overflows: ${left} + ${width}`);
  }
});
