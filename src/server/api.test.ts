import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { init } from "../commands/init.js";
import { defaultConfig, loadConfig } from "../config.js";
import { layoutFor, type Layout } from "../paths.js";
import { listProjects } from "../projects.js";
import type { AttemptRecord, MilestonerConfig, Pulse, RunState } from "../types.js";
import { ensureDir } from "../util/fs.js";
import {
  type ApiContext,
  doAttend,
  doKill,
  doSteer,
  doUnblock,
  initProject,
  lintFindings,
  readConfigFile,
  reportHtml,
  snapshot,
  startRun,
  stopRun,
  transcript,
  writeConfig,
} from "./api.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await delay(50);
  return check();
}

function quietly<T>(fn: () => T): T {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

const roots: string[] = [];

function attempt(n: number, transcriptName: string): AttemptRecord {
  return {
    attempt: n,
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(60_000).toISOString(),
    seconds: 60,
    exitCode: 0,
    transcript: transcriptName,
    outcome: "incomplete",
    agent: "claude",
  };
}

/** A run on disk, hand-built so every field the snapshot reads has a known value. */
function scaffold(prefix = "milestoner-api-"): { layout: Layout; ctx: ApiContext; config: MilestonerConfig } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  const layout = layoutFor(root);
  ensureDir(layout.logs);

  const state: RunState = {
    run: "api-fixture",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 12,
    milestones: [
      { id: "M01", title: "First", prompt: "M01.md", status: "done", attempts: 1, evidence: ["AC1: a test"], history: [attempt(1, "M01-a.log")] },
      {
        id: "M02",
        title: "Second",
        prompt: "M02.md",
        status: "blocked",
        attempts: 2,
        evidence: [],
        diagnosis: { symptom: "port busy", tried: ["freed 4400"], userAction: "stop the other server" },
        history: [attempt(1, "M02-a.log"), attempt(2, "M02-b.log")],
      },
      { id: "M03", title: "Third", prompt: "M03.md", status: "pending", attempts: 0, evidence: [], history: [] },
    ],
  };
  writeFileSync(layout.state, JSON.stringify(state, null, 2));
  for (const name of ["M01-a.log", "M02-a.log", "M02-b.log"]) writeFileSync(join(layout.logs, name), `body of ${name}`);

  const config: MilestonerConfig = {
    ...defaultConfig("api-fixture", root),
    maxAttempts: 4,
    models: { M02: "opus" },
  };
  writeFileSync(layout.config, JSON.stringify({ run: config.run, maxAttempts: 4, models: { M02: "opus" }, agent: config.agent, infra: {} }, null, 2));

  return { layout, ctx: { config, layout, cliPath: "" }, config };
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const fixture = scaffold();

test("the snapshot is the whole run in one object, in the fields the panel renders", () => {
  const d = snapshot(fixture.ctx);

  assert.equal(d.run, "api-fixture");
  assert.equal(d.rev, 12);
  assert.equal(d.runComplete, false);
  assert.deepEqual({ done: d.done, total: d.total, blocked: d.blocked }, { done: 1, total: 3, blocked: 1 });
  assert.equal(d.maxAttempts, 4, "the ceiling comes from the config, not the state");

  assert.deepEqual(d.milestones.map((m) => m.id), ["M01", "M02", "M03"]);
  const [first, second, third] = d.milestones;
  assert.equal(second!.status, "blocked");
  assert.equal(second!.diagnosis?.userAction, "stop the other server");
  assert.equal(second!.model, "opus", "a milestone's model is read out of config.models");
  assert.equal(first!.model, null, "and a milestone the map omits carries null, not the agent's own name");
  assert.equal(third!.history.length, 0);

  assert.equal(d.pulse, null, "no pulse.json means no runner to report on");
  assert.equal(d.steering, null, "no STEERING.md means nothing in force");
  assert.equal(d.liveness, null);
  assert.equal(d.livenessConfigured, false, "an empty watch list is the difference between quiet and unwatched");
  assert.equal(d.attendConfigured, false);
});

test("the snapshot tails the logs and the transcripts rather than serving all of them", () => {
  const { layout, ctx } = scaffold();
  writeFileSync(layout.runLog, Array.from({ length: 60 }, (_, i) => `run line ${i}`).join("\n") + "\n\n\n");
  writeFileSync(layout.supervisorLog, Array.from({ length: 40 }, (_, i) => `sup line ${i}`).join("\n"));

  const state = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
  state.milestones[2]!.history = Array.from({ length: 30 }, (_, i) => attempt(i + 1, `M03-${i}.log`));
  writeFileSync(layout.state, JSON.stringify(state));

  const d = snapshot(ctx);
  assert.equal(d.runLog.length, 40);
  assert.equal(d.runLog[0], "run line 20");
  assert.equal(d.runLog.at(-1), "run line 59", "the blank tail is dropped, not counted");
  assert.equal(d.supervisorLog.length, 20);
  assert.equal(d.supervisorLog[0], "sup line 20");
  assert.equal(d.transcripts.length, 25, "the panel offers the recent ones, whatever the run's length");
  assert.equal(d.transcripts.at(-1), "M03-29.log");

  writeFileSync(layout.steering, "- prefer the small fix\n");
  assert.match(snapshot(ctx).steering ?? "", /prefer the small fix/);
});

test("a live pulse is answered with the two pids the panel colours on", () => {
  const { layout, ctx } = scaffold();
  const dead = 999_999_999;
  const pulse: Pulse = {
    pid: process.pid,
    run: "api-fixture",
    startedAt: new Date().toISOString(),
    milestoneId: "M02",
    attempt: 2,
    sessionStartedAt: new Date(Date.now() - 30_000).toISOString(),
    agentPid: dead,
    transcript: "M02-b.log",
    lastEvent: "session started",
    lastEventAt: new Date().toISOString(),
  };
  writeFileSync(layout.pulse, JSON.stringify(pulse));

  const p = snapshot(ctx).pulse;
  assert.ok(p);
  assert.equal(p.milestoneId, "M02");
  assert.equal(p.runnerAlive, true, "this process is the runner in this fixture");
  assert.equal(p.agentAlive, false, "a pid nothing is holding is not a session");
  assert.ok(p.sessionSeconds !== null && p.sessionSeconds >= 29 && p.sessionSeconds <= 40, `sessionSeconds was ${p.sessionSeconds}`);
});

test("liveness reports the newest watched path, relative to the project", () => {
  const { layout, ctx } = scaffold();
  const watched = join(layout.projectRoot, "signal.txt");
  writeFileSync(watched, "work happened");
  const ago = new Date(Date.now() - 120_000);
  utimesSync(watched, ago, ago);
  ctx.config = { ...ctx.config, liveness: ["signal.txt"], environment: { attendCommand: "echo unstuck", attendSeconds: 30 } };

  const d = snapshot(ctx);
  assert.equal(d.livenessConfigured, true);
  assert.equal(d.attendConfigured, true, "the page hides the adapter button off this flag");
  assert.equal(d.liveness?.path, "signal.txt");
  assert.ok(d.liveness!.ageSeconds >= 115 && d.liveness!.ageSeconds <= 180, `ageSeconds was ${d.liveness!.ageSeconds}`);
});

test("a transcript is served by name alone, and nothing outside the logs directory resolves", () => {
  assert.equal(transcript(fixture.ctx, "M01-a.log"), "body of M01-a.log");
  for (const name of ["../../../../etc/passwd", "../config.json", "/etc/passwd", "M99-nope.log", ""]) {
    assert.equal(transcript(fixture.ctx, name), null, `${JSON.stringify(name)} must not resolve`);
  }

  const long = "x".repeat(250_000) + "END";
  writeFileSync(join(fixture.layout.logs, "M03-long.log"), long);
  const served = transcript(fixture.ctx, "M03-long.log");
  assert.equal(served?.length, 200_000, "a session's transcript is unbounded; what the browser gets is not");
  assert.ok(served!.endsWith("END"), "the tail is what is worth reading");
});

test("lintFindings answers in the shape lint --json prints", () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-api-lint-"));
  roots.push(root);
  assert.equal(quietly(() => init({ projectRoot: root, run: "lint-me", count: 2, force: false })).code, 0);
  const layout = layoutFor(root);
  const ctx: ApiContext = { config: loadConfig(layout.config, root), layout, cliPath: "" };

  const found = lintFindings(ctx);
  assert.equal(found.run, "lint-me");
  assert.deepEqual(Object.keys(found).sort(), ["errors", "findings", "run", "warnings"]);
  assert.ok(found.errors > 0, "a freshly scaffolded run still carries its placeholders");
  assert.equal(found.errors, found.findings.filter((f) => f.severity === "error").length);
  assert.equal(found.warnings, found.findings.filter((f) => f.severity === "warning").length);
  assert.ok(found.findings.every((f) => f.rule && f.message && f.file), "every finding names its rule, its sentence and its file");
});

test("the report is one self-contained HTML file, without the logs' own headings", () => {
  const { layout, ctx } = scaffold();
  writeFileSync(layout.runLog, "# run log heading\n`a fenced line`\nM01 attempt 1 started\n");

  const html = reportHtml(ctx);
  assert.match(html, /<!doctype html>/i);
  assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(html), "the report must open with no network");
  assert.match(html, /api-fixture/);
  assert.match(html, /M01 attempt 1 started/);
  assert.ok(!html.includes("run log heading"), "the markdown furniture is not run history");
});

test("steering is set, appended and cleared, and each answer says what happens next", () => {
  const { layout, ctx } = scaffold();

  const set = quietly(() => doSteer(ctx, "prefer the simpler fix", false, false));
  assert.equal(set.ok, true);
  assert.match(set.message, /applies to the next session launched/);
  assert.match(readFileSync(layout.steering, "utf8"), /- prefer the simpler fix/);

  quietly(() => doSteer(ctx, "do not touch the public API", true, false));
  const both = readFileSync(layout.steering, "utf8");
  assert.match(both, /- prefer the simpler fix/, "an append keeps what was there");
  assert.match(both, /- do not touch the public API/);

  const cleared = quietly(() => doSteer(ctx, undefined, false, true));
  assert.equal(cleared.ok, true);
  assert.equal(cleared.message, "steering cleared");
  assert.equal(existsSync(layout.steering), false);
});

test("unblock sets a blocked milestone back to pending, and refuses an id the run does not have", () => {
  const { layout, ctx } = scaffold();

  const done = quietly(() => doUnblock(ctx, "M02", false));
  assert.equal(done.ok, true);
  assert.equal(done.message, "M02 set to pending");
  let m = snapshot(ctx).milestones[1]!;
  assert.equal(m.status, "pending");
  assert.equal(m.attempts, 0, "the attempts are refunded unless the caller asks to keep them");
  assert.equal(m.diagnosis, null);

  const state = JSON.parse(readFileSync(layout.state, "utf8")) as RunState;
  state.milestones[1]!.status = "blocked";
  state.milestones[1]!.attempts = 2;
  writeFileSync(layout.state, JSON.stringify(state));

  assert.equal(quietly(() => doUnblock(ctx, "M02", true)).ok, true);
  m = snapshot(ctx).milestones[1]!;
  assert.equal(m.status, "pending");
  assert.equal(m.attempts, 2, "keepAttempts leaves the budget where it was");

  const unknown = quietly(() => doUnblock(ctx, "M99", false));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.message, "could not unblock M99");
});

test("kill says there is nothing to kill when no session is running", async () => {
  const killed = await quietly(() => doKill(fixture.ctx, "from a test"));
  assert.equal(killed.ok, false);
  assert.equal(killed.message, "nothing to kill");
});

test("the environment adapter runs for the seconds it is handed, and a project without one is told so", () => {
  const { layout, ctx } = scaffold();

  const none = quietly(() => doAttend(ctx, undefined));
  assert.equal(none.ok, false);
  assert.equal(none.message, "environment adapter failed");

  const marker = join(layout.projectRoot, "attended.txt");
  const adapter = join(layout.projectRoot, "adapter.cjs");
  writeFileSync(adapter, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.argv[2]));`);
  ctx.config = { ...ctx.config, environment: { attendCommand: `node "${adapter}" {{seconds}}`, attendSeconds: 90 } };

  assert.equal(quietly(() => doAttend(ctx, 42)).ok, true);
  assert.equal(readFileSync(marker, "utf8"), "42", "the seconds reach the adapter's own command line");

  rmSync(marker, { force: true });
  const fell_back = quietly(() => doAttend(ctx, undefined));
  assert.equal(fell_back.ok, true);
  assert.equal(fell_back.message, "environment adapter finished");
  assert.equal(readFileSync(marker, "utf8"), "90", "no seconds means environment.attendSeconds");
  assert.match(readFileSync(layout.supervisorLog, "utf8"), /attend 90s/, "the panel's intervention lands in the same log the CLI's does");
});

test("the config is served as it is on disk, and a save re-points the context the panel answers from", () => {
  const { layout, ctx } = scaffold();
  assert.equal(readConfigFile(ctx), readFileSync(layout.config, "utf8"));

  const saved = writeConfig(ctx, JSON.stringify({ run: "api-fixture", maxAttempts: 9, models: { M03: "sonnet" }, agent: {}, infra: {} }));
  assert.equal(saved.ok, true);
  const onDisk = JSON.parse(readFileSync(layout.config, "utf8")) as Record<string, unknown>;
  assert.equal(onDisk.maxAttempts, 9);
  assert.equal("projectRoot" in onDisk, false, "where the config was found is never what the config says");

  const d = snapshot(ctx);
  assert.equal(d.maxAttempts, 9, "a context resolved once must stop answering from the config it was built with");
  assert.equal(d.milestones[2]!.model, "sonnet");

  rmSync(layout.config, { force: true });
  assert.equal(readConfigFile(ctx), null, "a config that has gone under a long-lived panel is null, not a throw");
});

test("a config the next runner would refuse is refused here, in the loader's own words", () => {
  const { layout, ctx } = scaffold();
  const before = readFileSync(layout.config, "utf8");

  const cases: Array<[unknown, RegExp]> = [
    ["", /content is required/],
    ["   ", /content is required/],
    [null, /content is required/],
    [42, /content is required/],
    ["{ not json", /not valid JSON/],
    ["[1,2,3]", /must be a JSON object/],
    ['"a string"', /must be a JSON object/],
    ["null", /must be a JSON object/],
    ['{"agent":{},"infra":{}}', /missing required field "run"/],
    ['{"run":"r","infra":{}}', /missing required field "agent"/],
    ['{"run":"r","agent":{}}', /missing required field "infra"/],
  ];
  for (const [content, message] of cases) {
    const res = writeConfig(ctx, content);
    assert.equal(res.ok, false, `${JSON.stringify(content)} must be refused`);
    assert.match(res.message, message);
    assert.equal(readFileSync(layout.config, "utf8"), before, "a refusal writes nothing at all");
  }
  assert.equal(loadConfig(layout.config, layout.projectRoot).run, "api-fixture", "and the file still loads");
});

test("a start is refused before anything is spawned: a live runner, a bad option, a failing lint", async () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-api-start-"));
  roots.push(root);
  assert.equal(quietly(() => init({ projectRoot: root, run: "start-me", count: 2, force: false })).code, 0);
  const layout = layoutFor(root);

  const marker = join(root, "spawned.txt");
  const cliPath = join(root, "fake-cli.cjs");
  writeFileSync(cliPath, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`);
  const ctx: ApiContext = { config: loadConfig(layout.config, root), layout, cliPath };

  writeFileSync(layout.pulse, JSON.stringify({ pid: process.pid, run: "start-me" }));
  const busy = startRun(ctx, { noLint: true });
  assert.equal(busy.ok, false);
  assert.match(busy.message, /a runner is already running \(pid \d+\)/, "two runners on one state.json is the thing to stop");
  rmSync(layout.pulse, { force: true });

  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ milestone: "M99" }, /no milestone with id "M99"/],
    [{ milestone: "   " }, /milestone must be the id/],
    [{ maxAttempts: 0 }, /maxAttempts must be a positive integer/],
    [{ maxAttempts: 2.5 }, /maxAttempts must be a positive integer/],
    [{ model: "  " }, /model must be a non-empty string/],
    [{ once: "yes" }, /once must be true or false/],
  ];
  for (const [options, message] of bad) {
    const res = startRun(ctx, { noLint: true, ...options });
    assert.equal(res.ok, false, `${JSON.stringify(options)} must be refused`);
    assert.match(res.message, message);
  }

  const gated = startRun(ctx, {});
  assert.equal(gated.ok, false);
  assert.equal(gated.lintRefused, true, "the panel offers the bypass off this flag alone");
  assert.match(gated.message, /refusing to start: .*error/);

  await delay(400);
  assert.equal(existsSync(marker), false, "not one of those reached a spawn");
});

test("a start that passes every check spawns the runner with the options as flags", async () => {
  const root = mkdtempSync(join(tmpdir(), "milestoner-api-spawn-"));
  roots.push(root);
  assert.equal(quietly(() => init({ projectRoot: root, run: "spawn-me", count: 2, force: false })).code, 0);
  const layout = layoutFor(root);
  const marker = join(root, "spawned.txt");
  const cliPath = join(root, "fake-cli.cjs");
  writeFileSync(cliPath, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`);
  const ctx: ApiContext = { config: loadConfig(layout.config, root), layout, cliPath };

  const started = startRun(ctx, { noLint: true, milestone: "M02", once: true, maxAttempts: 5, model: "opus" });
  assert.equal(started.ok, true);
  assert.match(started.message, /runner started \(pid \d+\)/);
  assert.ok(await waitFor(() => existsSync(marker)), "the runner must actually be spawned");
  assert.equal(readFileSync(marker, "utf8"), "run --milestone M02 --once --max-attempts 5 --model opus --no-lint");

  rmSync(marker, { force: true });
  assert.equal(startRun(ctx, { noLint: true }).ok, true);
  assert.ok(await waitFor(() => existsSync(marker)));
  assert.equal(readFileSync(marker, "utf8"), "run --no-lint", "an optionless start is the command it always was");
});

test("initProject scaffolds through the CLI's own init, files the project, and hands back the refusals", () => {
  const home = mkdtempSync(join(tmpdir(), "milestoner-api-home-"));
  roots.push(home);
  const projectsFile = join(home, "projects.json");
  const target = mkdtempSync(join(tmpdir(), "milestoner-api-init-"));
  roots.push(target);

  const made = quietly(() => initProject({ path: target, run: "born-here", milestones: 4 }, projectsFile));
  assert.equal(made.ok, true);
  assert.equal(made.root, resolve(target));
  const layout = layoutFor(target);
  assert.ok(existsSync(layout.config) && existsSync(layout.state) && existsSync(layout.protocol));
  assert.deepEqual(
    (JSON.parse(readFileSync(layout.state, "utf8")) as RunState).milestones.map((m) => m.id),
    ["M01", "M02", "M03", "M04"],
  );
  assert.deepEqual(listProjects(projectsFile).map((p) => p.root), [resolve(target)], "the hub lists it on the next refresh off this");

  const refusals: Array<[Record<string, unknown>, RegExp]> = [
    [{}, /path is required/],
    [{ path: "   " }, /path is required/],
    [{ path: "relative/dir" }, /path must be absolute/],
    [{ path: join(target, "nowhere") }, /no such directory/],
    [{ path: layout.config }, /is not a directory/],
    [{ path: target, run: "" }, /run must be a non-empty name/],
    [{ path: target, milestones: 0 }, /milestones must be an integer between 1 and 99/],
    [{ path: target, milestones: 100 }, /milestones must be an integer between 1 and 99/],
    [{ path: target, force: "yes" }, /force must be true or false/],
  ];
  for (const [body, message] of refusals) {
    const res = quietly(() => initProject(body, projectsFile));
    assert.equal(res.ok, false, `${JSON.stringify(body)} must be refused`);
    assert.match(res.message, message);
  }

  const exists = quietly(() => initProject({ path: target, run: "born-here" }, projectsFile));
  assert.equal(exists.ok, false);
  assert.equal(exists.forceable, true, "only a refusal force answers reveals the checkbox");

  const otherRun = quietly(() => initProject({ path: target, run: "someone-else", force: true }, projectsFile));
  assert.equal(otherRun.ok, false);
  assert.match(otherRun.message, /born-here/, "a protocol naming another run is D-030's refusal, surfaced not swallowed");
  assert.ok(!otherRun.forceable, "and force is not the answer to it");
});

test("stopRun interrupts the runner it finds, and says so when there is none", async () => {
  const { layout, ctx } = scaffold();

  const nothing = stopRun(ctx);
  assert.equal(nothing.ok, false);
  assert.equal(nothing.message, "no runner is running");

  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" });
  child.unref();
  writeFileSync(layout.pulse, JSON.stringify({ pid: child.pid, run: "api-fixture" }));
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    const stopped = stopRun(ctx);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.message, "stopping after the current session finishes");
    assert.ok(await waitFor(() => exited), "one interrupt is the runner's own finish-then-stop");
  } finally {
    if (!exited) child.kill("SIGKILL");
  }
});
