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
  const html = buildReport({ state: hostile, maxAttempts: 3, runLog: ["<img onerror=x>"], supervisorLog: [], generatedAt: new Date(0) });

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
    maxAttempts: 3,
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
  const html = buildReport({ state, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date(0) });
  assert.ok(!/<(script|iframe)\b/i.test(html), "no scripts");
  assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), "no external assets");
});

test("timeline segments stay inside the track", () => {
  const html = buildReport({ state, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-18T21:30:00.000Z") });
  for (const [, left, width] of html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)) {
    assert.ok(Number(left) + Number(width) <= 100.01, `segment overflows: ${left} + ${width}`);
  }
});

test("an in-progress milestone with no graded history reads as in progress, never as never started", () => {
  const midRun = normalizeState({
    run: "mid-run",
    createdAt: "2026-08-22T19:30:00.000Z",
    runComplete: false,
    milestones: [
      {
        id: "M03",
        title: "The live one",
        status: "in_progress",
        attempts: 0,
        startedAt: "2026-08-22T19:58:27.435Z",
        evidence: [],
        history: [],
      },
    ],
  });
  const html = buildReport({ state: midRun, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-22T20:10:00.000Z") });

  assert.ok(html.includes("in progress since 2026-08-22 19:58, no session graded yet"), "the card says what is actually happening");
  assert.ok(html.includes("still in progress when this report was generated"), "and the empty evidence block matches");
  assert.ok(!html.includes("no evidence recorded"), "the pending wording stays off an in-progress card");
  assert.ok(!html.includes("0 sessions"), "a zero count is not how an unfinished milestone is described");
  assert.ok(!html.includes("Not started yet."));
});

test("the served report links back to the panel and the file on disk carries no such link", () => {
  const served = buildReport({
    state,
    maxAttempts: 3,
    runLog: [],
    supervisorLog: [],
    generatedAt: new Date(0),
    panelHref: "/?root=%2Ftmp%2Fdemo&token=abc",
  });
  assert.ok(served.includes(`<a href="/?root=%2Ftmp%2Fdemo&amp;token=abc">&larr; back to the panel</a>`), "the link names the view it came from");
  assert.ok(served.includes("archival snapshot"), "and one line says what this file is for beside the panel");

  const file = buildReport({ state, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date(0) });
  assert.ok(!file.includes("back to the panel"), "a file that travels must not link to a panel that is not there");
  assert.ok(!file.includes("<a href"), "the standalone report carries no links at all");
  assert.ok(!file.includes("archival snapshot"), "the note explains the panel/report split, so it belongs on the served one");
});

test("timeline bars carry their durations and the timeline states its extent", () => {
  const html = buildReport({ state, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-18T21:30:00.000Z") });

  assert.ok(html.includes(`<span class="track-time">20m &middot; 20m</span>`), "each of M01's two sessions states its own duration");
  assert.ok(html.includes("Scale: 2026-08-18 20:00 to 2026-08-18 21:00, 1h 0m end to end"), "the timeline says what its width is worth");
  const ticks = [...html.matchAll(/class="tick[^"]*" style="left:[\d.]+%">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(ticks, ["20:00", "20:15", "20:30", "20:45", "21:00"], "the axis is labelled end to end");
  assert.ok(html.includes("attempt 1: infrastructure, 20m"), "and a bar's own tooltip names its outcome and its duration");
});

test("a session with no end recorded gets a bar but never a duration", () => {
  const open = normalizeState({
    run: "open-run",
    createdAt: "2026-08-22T19:00:00.000Z",
    runComplete: false,
    milestones: [
      {
        id: "M01",
        title: "Still going",
        status: "in_progress",
        attempts: 1,
        evidence: [],
        history: [
          { attempt: 1, startedAt: "2026-08-22T19:10:00.000Z", endedAt: "", seconds: 900, exitCode: null, transcript: "logs/M01-a.log", outcome: "incomplete" },
        ],
      },
    ],
  });
  const html = buildReport({ state: open, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-22T19:40:00.000Z") });

  assert.ok(html.includes(`<span class="track-time">no end recorded</span>`), "an unfinished session says so instead of showing a length");
  assert.ok(html.includes("seg open"), "it still gets a bar, drawn as open-ended");
  const bar = /<span class="seg open"[^>]*title="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.equal(bar, "attempt 1: started 19:10, no end recorded", "the bar's tooltip names its start and stops there");
  assert.ok(!/\d+[ms]\b/.test(bar), "no length is invented, from the clock or from the record's seconds field");
  for (const [, left, width] of html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)) {
    assert.ok(Number(left) + Number(width) <= 100.01, `an open bar overflows the track: ${left} + ${width}`);
  }
});

test("the headline states the truth for every run state, never-started included", () => {
  const milestones = (over: Record<string, unknown>[]) =>
    over.map((m, i) => ({ id: `M0${i + 1}`, title: `M0${i + 1}`, attempts: 0, evidence: [], history: [], ...m }));
  const headline = (raw: Record<string, unknown>) => {
    const html = buildReport({ state: normalizeState(raw), maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-22T20:00:00.000Z") });
    return /<h1>[^<]*<span class="pill [\w-]+">([^<]+)<\/span>/.exec(html)?.[1] ?? "";
  };

  const scaffolded = { run: "fresh", createdAt: "2026-08-22T19:00:00.000Z", runComplete: false, milestones: milestones([{ status: "pending" }, { status: "pending" }]) };
  assert.equal(headline(scaffolded), "not started yet", "a scaffolded run with zero sessions has not started");
  const fresh = buildReport({ state: normalizeState(scaffolded), maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date("2026-08-22T20:00:00.000Z") });
  assert.ok(!fresh.includes("in progress"), "nothing on the page claims a run that never launched is under way");
  assert.ok(fresh.includes("nothing to place on the clock"), "and the timeline says why it is empty");

  assert.equal(
    headline({ run: "flying", createdAt: "2026-08-22T19:00:00.000Z", runComplete: false, milestones: milestones([{ status: "done" }, { status: "in_progress" }]) }),
    "in progress",
  );
  assert.equal(
    headline({ run: "stuck", createdAt: "2026-08-22T19:00:00.000Z", runComplete: false, milestones: milestones([{ status: "done" }, { status: "blocked" }]) }),
    "blocked at M02",
  );
  assert.equal(
    headline({ run: "finished", createdAt: "2026-08-22T19:00:00.000Z", runComplete: true, milestones: milestones([{ status: "done" }, { status: "done" }]) }),
    "run complete",
  );
});

test("the attempt budget comes from the config, not from what happened to be spent", () => {
  const html = buildReport({ state, maxAttempts: 3, runLog: [], supervisorLog: [], generatedAt: new Date(0) });

  assert.ok(html.includes("1/3 attempts charged"), "M01 spent one of the three the config allows");
  assert.ok(html.includes("2/3 attempts charged"), "M02 spent two of three");
  assert.ok(!html.includes("/2 attempts"), "the highest attempt count observed in the run is not the budget");
  assert.ok(html.includes("2 sessions"), "the session count is what says how many times the agent actually ran");
});
