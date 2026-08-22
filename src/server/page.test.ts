import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE } from "./page.js";

const grab = (head: string): string => {
  const found = PAGE.match(new RegExp(head + "[\\s\\S]*?\\n\\}"));
  assert.ok(found, `the page must carry ${head}`);
  return found[0];
};

/** The card builder is pure on purpose, like lintCardHtml: rendering it here proves the markup
    without a browser. Its helpers travel with it. */
function cardBuilder(): (m: unknown, d: unknown) => string {
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

/** interventionsHtml is pure for the same reason milestoneCardHtml is. */
function interventionsBuilder(): (lines: string[] | null) => string {
  const src = [
    PAGE.match(/const esc = .*$/m)?.[0],
    grab("function ago\\(iso\\) \\{"),
    PAGE.match(/const LOG_HEADER = .*$/m)?.[0],
    grab("function interventionsHtml\\(lines\\) \\{"),
  ];
  assert.ok(src.every(Boolean), "the page must carry interventionsHtml and its helpers");
  return new Function(`${src.join("\n")}\nreturn interventionsHtml;`)() as (lines: string[] | null) => string;
}

/** The header `init` writes into supervisor-log.md before anything has ever intervened. */
const LOG_HEADER_LINES = ["# Supervisor log", "`<time> | <rule> | <what> | <result>`"];

test("a supervisor log holding only its own header renders no intervention at all", () => {
  const html = interventionsBuilder();

  for (const lines of [[], LOG_HEADER_LINES, null]) {
    const out = html(lines);
    assert.ok(out.includes("No interventions"), "the card says nothing stepped in");
    assert.ok(out.includes("nothing outside the run has had to step in"), "and says why that is fine");
    assert.ok(!out.includes("<time"), "an empty state carries no timestamp to hover");
    for (const leak of ["Supervisor log", "&lt;rule&gt;", "&lt;what&gt;", "&lt;result&gt;"]) {
      assert.ok(!out.includes(leak), `the template line never renders: ${leak}`);
    }
  }
});

test("a real intervention renders its time, its rule and its result", () => {
  const html = interventionsBuilder();
  const out = html([...LOG_HEADER_LINES, "2026-08-22T20:00:00.000Z | 4 | killed the session | attempt charged"]);

  assert.ok(!out.includes("No interventions"), "one line is enough to fill the card");
  assert.match(out, /<time title="2026-08-22T20:00:00.000Z"/, "the stamp stays on hover");
  assert.ok(out.includes("<strong>4</strong>"), "the rule that fired leads the line");
  assert.ok(out.includes("killed the session - attempt charged"), "what it did and what came of it");
  assert.ok(!out.includes("Supervisor log"), "with the file's own header still filtered out");
});

/* Tooltips hide on touch, so every card's explanation must survive with the titles stripped. */
const VISIBLE = PAGE.replace(/ title="[^"]*"/g, "");

test("every card on the run view carries a visible one-line explanation", () => {
  const explains: [string, string][] = [
    ["verdict", "Alive, slow and hung are the age of the newest liveness signal"],
    ["lint", "error-level ones on pending milestones refuse a start"],
    ["milestones", "one card per milestone: what it is for, the attempts it has spent"],
    ["steering", "a correction read by the next session launched, not by the one running"],
    ["config", ".milestoner/config.json, checked by the loader before it is written"],
    ["engine log", "every event the runner recorded in .milestoner/run-log.md, newest first"],
    ["interventions", "outside actions on the run: a hung session killed by a supervisor rule or from this panel"],
    ["report link", "One self-contained HTML file, no scripts and no external assets"],
  ];
  for (const [card, line] of explains) {
    assert.ok(VISIBLE.includes(line), `the ${card} card must explain itself in visible text: ${line}`);
  }
});

test("the empty states say something true instead of leaking a file's scaffold", () => {
  const empties = [
    "Nothing has happened yet.",
    "Not started yet.",
    "no steer in force",
    "every prompt, the protocol and the config pass the form checks",
    "No projects on this machine yet.",
    "nothing outside the run has had to step in",
  ];
  for (const line of empties) assert.ok(PAGE.includes(line), `an empty state is missing: ${line}`);
});

const titleOn = (marker: string): string => {
  const found = PAGE.match(new RegExp(marker + ' title="([^"]+)"'));
  assert.ok(found, `${marker} must carry a title`);
  return found[1]!;
};

test("the destructive controls say what they cost", () => {
  const kill = titleOn('onclick="killAgent\\(\\)"');
  assert.match(kill, /costs an attempt/, "kill names the attempt it spends");
  assert.match(kill, /relaunches/, "and that the runner comes straight back");

  const anyway = titleOn('onclick="startRun\\(true\\)"');
  assert.match(anyway, /--no-lint/, "start-anyway names the flag it runs with");
  assert.match(anyway, /gate above is skipped/, "and the gate it skips");

  const stop = titleOn('onclick="post\\(..\\/api\\/run\\/stop..\\)"');
  assert.match(stop, /finish and be graded/, "stop is the one that costs nothing");
  assert.match(stop, /no attempt is charged/);
});

test("every consequential control carries a tooltip", () => {
  const controls = [
    'onclick="startRun\\(\\)"',
    'onclick="attendNow\\(\\)"',
    'onclick="saveConfig\\(\\)"',
    'onclick="saveProtocol\\(\\)"',
    'onclick="addMilestone\\(\\)"',
    'onclick="doInit\\(\\)"',
    'onclick="steer\\(false\\)"',
    'onclick="steer\\(true\\)"',
  ];
  for (const c of controls) assert.ok(titleOn(c).length > 20, `${c} needs a title that says something`);

  for (const opt of ["optMilestone", "optOnce", "optAttempts", "optModel"]) {
    assert.match(PAGE, new RegExp('title="[^"]+">[^<]*<(select|input) data-w id="' + opt + '"'), `${opt} needs a title`);
  }
  const unblocks = [...PAGE.matchAll(/title="([^"]+)" onclick="post\(..\/api\/unblock/g)].map((m) => m[1]!);
  assert.equal(unblocks.length, 2, "both unblock buttons carry one");
  assert.ok(unblocks.some((t) => /returns the attempts it spent/.test(t)));
  assert.ok(unblocks.some((t) => /keeps the attempts already spent/.test(t)));
});

test("the page's inline script is parseable javascript", () => {
  const script = PAGE.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(script, "the page must carry its script");
  // Never called: constructing it is the syntax check, and the body wants a browser to run in.
  assert.doesNotThrow(() => new Function(script[1]!));
});
