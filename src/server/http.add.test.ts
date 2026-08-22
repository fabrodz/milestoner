import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { init } from "../commands/init.js";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { loadState } from "../state.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "add-test-token";

function capture<T>(fn: () => T): T {
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

function scaffold(run: string): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-http-add-"));
  const scaffolded = capture(() => init({ projectRoot: root, run, count: 2, force: false }));
  assert.equal(scaffolded.code, 0, "the scaffold must succeed");
  return layoutFor(root);
}

function panelFor(layout: ReturnType<typeof layoutFor>, allowWrites: boolean) {
  const config = loadConfig(layout.config, layout.projectRoot);
  return createPanel({ scope: { kind: "project", ctx: { config, layout, cliPath: "" } }, port: 0, token: TOKEN, allowWrites });
}

const layout = scaffold("add-api");
const panel = panelFor(layout, true);
const readOnly = panelFor(layout, false);
let base = "";
let readOnlyBase = "";

before(async () => {
  await new Promise<void>((r) => panel.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => readOnly.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  readOnlyBase = `http://127.0.0.1:${(readOnly.address() as AddressInfo).port}`;
});
after(() => {
  panel.close();
  readOnly.close();
});

interface Reply {
  ok: boolean;
  message: string;
}

async function addMilestone(body: unknown, at = base): Promise<{ status: number; body: Reply }> {
  const res = await fetch(`${at}/api/milestone/add?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply };
}

interface Snapshot {
  rev: number;
  runComplete: boolean;
  milestones: Array<{ id: string; title: string; prompt: string; status: string }>;
}

const snapshot = async (): Promise<Snapshot> => (await (await fetch(`${base}/api/state?token=${TOKEN}`)).json()) as Snapshot;

test("POST /api/milestone/add appends the next milestone and the snapshot carries it", async () => {
  const initial = await snapshot();
  assert.equal(initial.milestones.length, 2, "the fixture starts with two");

  const { status, body } = await addMilestone({});
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /M03/, "the reply names the new id");

  const snap = await snapshot();
  assert.ok(snap.rev > initial.rev, "the append bumped the rev, so the stream re-sends the run");
  const m = snap.milestones.at(-1);
  assert.equal(m?.id, "M03");
  assert.equal(m?.status, "pending");
  assert.equal(m?.prompt, "M03.md");
  assert.ok(existsSync(join(layout.prompts, "M03.md")), "the skeleton is on disk");

  const titled = await addMilestone({ title: "a named one" });
  assert.equal(titled.status, 200);
  assert.match(titled.body.message, /M04/);
  assert.equal((await snapshot()).milestones.at(-1)?.title, "a named one");
});

test("a title that is not text is refused, and nothing is appended", async () => {
  const count = (await snapshot()).milestones.length;
  for (const title of [7, false, {}, []]) {
    const { status, body } = await addMilestone({ title });
    assert.equal(status, 409, `${JSON.stringify(title)} must be refused`);
    assert.equal(body.ok, false);
    assert.match(body.message, /title must be text/);
  }
  assert.equal((await snapshot()).milestones.length, count, "every refusal left the run as it was");
});

test("the endpoint needs the key, the Origin and a write-enabled panel", async () => {
  const stateBefore = readFileSync(layout.state, "utf8");

  const ro = await addMilestone({}, readOnlyBase);
  assert.equal(ro.status, 403, "a read-only panel refuses the append like every other mutation");

  const anon = await fetch(`${base}/api/milestone/add`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(anon.status, 401, "no key, no append");

  const crossOrigin = await fetch(`${base}/api/milestone/add?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example.com" },
    body: JSON.stringify({}),
  });
  assert.equal(crossOrigin.status, 403, "the Origin check covers it like any other POST");

  assert.equal(readFileSync(layout.state, "utf8"), stateBefore, "none of them reached state.json");
});

test("appending to a completed run clears runComplete through the panel too", async () => {
  const state = loadState(layout.state);
  for (const m of state.milestones) m.status = "done";
  state.runComplete = true;
  writeFileSync(layout.state, JSON.stringify(state));
  assert.equal((await snapshot()).runComplete, true, "the fixture is a completed run");

  const { status, body } = await addMilestone({ title: "the afterthought" });
  assert.equal(status, 200);
  assert.match(body.message, /has work again/, "the reply says the flag was cleared");
  assert.equal((await snapshot()).runComplete, false);
});

test("the page carries the add control", () => {
  assert.ok(PAGE.includes('id="addTitle"'), "the title field is on the page");
  assert.ok(PAGE.includes("addMilestone()"), "the control is reachable from a button");
  assert.ok(PAGE.includes('post("/api/milestone/add"'), "and it talks to the endpoint");
  assert.ok(/data-w id="addTitle"/.test(PAGE) && /data-w onclick="addMilestone\(\)"/.test(PAGE), "both halves disable on a read-only panel");
});
