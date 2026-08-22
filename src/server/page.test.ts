import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE } from "./page.js";

/** The card builder is pure on purpose, like lintCardHtml: rendering it here proves the markup
    without a browser. Its helpers travel with it. */
function cardBuilder(): (m: unknown, d: unknown) => string {
  const grab = (head: string): string => {
    const found = PAGE.match(new RegExp(head + "[\\s\\S]*?\\n\\}"));
    assert.ok(found, `the page must carry ${head}`);
    return found[0];
  };
  const src = [
    PAGE.match(/const esc = .*$/m)?.[0],
    grab("function dur\\(s\\) \\{"),
    grab("function ago\\(iso\\) \\{"),
    PAGE.match(/const OUTCOME = .*$/m)?.[0],
    PAGE.match(/const OUTCOME_CLASS = .*$/m)?.[0],
    grab("function milestoneCardHtml\\(m, d\\) \\{"),
  ];
  assert.ok(src.every(Boolean), "the page must carry milestoneCardHtml and its helpers");
  return new Function(`${src.join("\n")}\nreturn milestoneCardHtml;`)() as (m: unknown, d: unknown) => string;
}

const milestone = (over: Record<string, unknown> = {}) => ({
  id: "M03",
  title: "The live one",
  prompt: "M03.md",
  status: "in_progress",
  attempts: 0,
  evidence: [],
  diagnosis: null,
  startedAt: "2026-08-22T19:58:27.435Z",
  finishedAt: null,
  history: [],
  model: null,
  ...over,
});

const pulse = (over: Record<string, unknown> = {}) => ({
  pid: 11,
  run: "demo",
  milestoneId: "M03",
  attempt: 1,
  sessionStartedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  agentPid: 12,
  agent: "claude",
  transcript: "M03-20260822-195827.log",
  runnerAlive: true,
  agentAlive: true,
  sessionSeconds: 300,
  ...over,
});

const data = (p: unknown) => ({ maxAttempts: 3, pulse: p });

test("a live pulse naming the milestone puts the running session on its card", () => {
  const card = cardBuilder();
  const html = card(milestone(), data(pulse()));

  assert.ok(html.includes("attempt 1 of 3 running"), "the counter counts the in-flight attempt");
  assert.match(html, /session started <time[^>]*>(5 min ago|just now)<\/time>/, "the elapsed time is on the card");
  assert.ok(html.includes('viewLog("M03-20260822-195827.log")'), "the live transcript is one click away");
  assert.ok(html.includes("watch the live transcript"));
  assert.ok(html.includes("agent claude"), "the agent name shows when the pulse carries one");
  assert.ok(!html.includes("Not started yet."), "an in-progress card never reads as never started");
});

test("a dead runner leaves the card claiming no live session", () => {
  const card = cardBuilder();
  const html = card(milestone(), data(pulse({ runnerAlive: false })));

  assert.ok(!html.includes("watch the live transcript"));
  assert.ok(!html.includes("running"), "no in-flight attempt is claimed");
  assert.ok(html.includes("the runner is gone"), "the stale case says so instead");
  assert.ok(html.includes("no attempts used"), "the counter falls back to the graded count");
  assert.ok(!html.includes("Not started yet."));
});

test("a pulse on another milestone claims nothing on this card", () => {
  const card = cardBuilder();
  const html = card(milestone(), data(pulse({ milestoneId: "M04" })));

  assert.ok(!html.includes("watch the live transcript"));
  assert.ok(html.includes("the runner is on another milestone"));
  assert.ok(html.includes("no attempts used"));
});

test("Not started yet. appears only on a pending milestone with no history and no live session", () => {
  const card = cardBuilder();

  assert.ok(card(milestone({ status: "pending" }), data(null)).includes("Not started yet."));
  assert.ok(!card(milestone({ status: "pending", id: "M04" }), data(pulse({ milestoneId: "M04" }))).includes("Not started yet."));
  assert.ok(!card(milestone(), data(pulse({ runnerAlive: false }))).includes("Not started yet."));
  const history = [{ attempt: 1, startedAt: "2026-08-22T19:00:00.000Z", endedAt: "2026-08-22T19:10:00.000Z", seconds: 600, exitCode: 1, transcript: "M03-a.log", outcome: "incomplete" }];
  assert.ok(!card(milestone({ status: "pending", history }), data(null)).includes("Not started yet."));
});

test("the graded history stays on the card below a live session", () => {
  const card = cardBuilder();
  const history = [{ attempt: 1, startedAt: "2026-08-22T19:00:00.000Z", endedAt: "2026-08-22T19:10:00.000Z", seconds: 600, exitCode: 1, transcript: "M03-a.log", outcome: "incomplete" }];
  const html = card(milestone({ attempts: 1, history }), data(pulse({ attempt: 2 })));

  assert.ok(html.includes("attempt 2 of 3 running"), "the counter follows the in-flight attempt, not the graded one");
  assert.ok(html.includes("did not finish"), "the graded attempt keeps its row");
  assert.ok(html.includes('viewLog("M03-a.log")'), "with its transcript");
  assert.ok(html.includes("watch the live transcript"), "beside the live block");
});

test("the attempts counter reads the graded count when nothing is live", () => {
  const card = cardBuilder();
  const history = [{ attempt: 1, startedAt: "2026-08-22T19:00:00.000Z", endedAt: "2026-08-22T19:10:00.000Z", seconds: 600, exitCode: 1, transcript: "M03-a.log", outcome: "incomplete" }];
  const html = card(milestone({ attempts: 1, history }), data(null));

  assert.ok(html.includes("1 of 3 attempts used"));
  assert.ok(!html.includes("running"));
});

test("the run view renders every milestone card through the pure builder", () => {
  assert.ok(PAGE.includes("d.milestones.map(m => milestoneCardHtml(m, d)).join(\"\")"), "render must go through milestoneCardHtml");
});
