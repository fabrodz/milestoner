import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "init-test-token";

/** init prints its scaffold to stdout, which is the panel process's business and not the TAP log. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

const home = mkdtempSync(join(tmpdir(), "milestoner-inithome-"));
const registryFile = join(home, "runs.json");
const projectsFile = join(home, "projects.json");
writeFileSync(registryFile, JSON.stringify({ runs: [] }));

const scope = { kind: "machine", registry: registryFile, projects: projectsFile, cliPath: "" } as const;
const panel = createPanel({ scope, port: 0, token: TOKEN, allowWrites: true });
const readOnly = createPanel({ scope, port: 0, token: TOKEN, allowWrites: false });
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

interface InitReply {
  ok: boolean;
  message: string;
  forceable?: boolean;
  root?: string;
}

const emptyDir = () => mkdtempSync(join(tmpdir(), "milestoner-initweb-"));

async function initPost(body: Record<string, unknown>, at = base): Promise<{ status: number; body: InitReply }> {
  return quietly(async () => {
    const res = await fetch(`${at}/api/init?token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as InitReply };
  });
}

const hubRuns = async (): Promise<Array<{ run: string; projectRoot: string }>> =>
  ((await (await fetch(`${base}/api/state?token=${TOKEN}`)).json()) as { runs: Array<{ run: string; projectRoot: string }> }).runs;

test("a fresh directory is scaffolded through the panel and filed in the projects file", async () => {
  const dir = emptyDir();
  const { status, body } = await initPost({ path: dir, run: "from-the-web", milestones: 4 });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.root, resolve(dir), "the reply names the root, so the hub can open it");
  assert.match(body.message, /initialized \.milestoner\/ for run "from-the-web"/);

  const layout = layoutFor(dir);
  for (const file of [layout.config, layout.state, layout.protocol, layout.supervisorLog]) {
    assert.ok(existsSync(file), `${file} must have been written`);
  }
  for (const id of ["M01", "M02", "M03", "M04"]) {
    assert.ok(existsSync(join(layout.prompts, `${id}.md`)), `prompts/${id}.md must have been written`);
  }
  const state = JSON.parse(readFileSync(layout.state, "utf8")) as { run: string; milestones: unknown[] };
  assert.equal(state.run, "from-the-web");
  assert.equal(state.milestones.length, 4, "the milestone count is the one the form sent");
  assert.match(readFileSync(layout.protocol, "utf8"), /# Execution protocol - run "from-the-web"/);

  const filed = (JSON.parse(readFileSync(projectsFile, "utf8")) as { projects: Array<{ root: string }> }).projects;
  assert.ok(filed.some((p) => p.root === resolve(dir)), "the new project is recorded, so the hub lists it with no CLI run");

  const runs = await hubRuns();
  assert.ok(runs.some((r) => r.run === "from-the-web"), "and the hub lists it on the very next request");
});

test("a relative path and a directory that is not there are refused before anything is written", async () => {
  for (const path of ["relative-project", "./somewhere", "prompts/../x"]) {
    const { status, body } = await initPost({ path });
    assert.equal(status, 409, `${path} must be refused`);
    assert.equal(body.ok, false);
    assert.match(body.message, /path must be absolute/);
    assert.ok(!existsSync(join(process.cwd(), path, ".milestoner")), "a relative path must not resolve against the panel's cwd");
  }

  const missing = join(home, "never-created");
  const gone = await initPost({ path: missing });
  assert.equal(gone.status, 409);
  assert.match(gone.body.message, /no such directory/);
  assert.ok(!existsSync(missing), "the endpoint scaffolds into a directory, it never makes one");

  const file = join(home, "a-file.txt");
  writeFileSync(file, "not a directory");
  const notDir = await initPost({ path: file });
  assert.equal(notDir.status, 409);
  assert.match(notDir.body.message, /is not a directory/);
  assert.equal(readFileSync(file, "utf8"), "not a directory", "the file is left alone");

  const empty = await initPost({});
  assert.equal(empty.status, 409);
  assert.match(empty.body.message, /path is required/);
});

test("an existing config is refused, the refusal offers force, and force goes through", async () => {
  const dir = emptyDir();
  assert.equal((await initPost({ path: dir, run: "first-go", milestones: 1 })).status, 200);

  const again = await initPost({ path: dir, run: "first-go" });
  assert.equal(again.status, 409);
  assert.equal(again.body.ok, false);
  assert.match(again.body.message, /config\.json already exists - use --force/);
  assert.equal(again.body.forceable, true, "the page surfaces its force box off this flag");

  const layout = layoutFor(dir);
  assert.equal(
    (JSON.parse(readFileSync(layout.state, "utf8")) as { milestones: unknown[] }).milestones.length,
    1,
    "the refused call must not have rewritten the state",
  );

  const forced = await initPost({ path: dir, run: "first-go", milestones: 5, force: true });
  assert.equal(forced.status, 200);
  assert.equal(
    (JSON.parse(readFileSync(layout.state, "utf8")) as { milestones: unknown[] }).milestones.length,
    5,
    "force is what rewrites the state",
  );
});

test("a protocol naming another run is refused even with force, and force is not offered", async () => {
  const dir = emptyDir();
  assert.equal((await initPost({ path: dir, run: "old-run", milestones: 1 })).status, 200);
  const layout = layoutFor(dir);
  const protocol = readFileSync(layout.protocol, "utf8");

  const { status, body } = await initPost({ path: dir, run: "new-run", force: true });
  assert.equal(status, 409);
  assert.match(body.message, /names run "old-run", not "new-run"/, "D-030's refusal is the panel's message, not a swallowed exit code");
  assert.ok(!body.forceable, "force does not answer this one, so the page must not offer it");
  assert.equal(readFileSync(layout.protocol, "utf8"), protocol, "the hand-edited protocol survives untouched");
  assert.equal((JSON.parse(readFileSync(layout.state, "utf8")) as { run: string }).run, "old-run");
});

test("the milestone count, the run name and force are each checked before init is called", async () => {
  const dir = emptyDir();
  for (const milestones of [0, 100, 2.5, "3", null]) {
    const { status, body } = await initPost({ path: dir, milestones });
    assert.equal(status, 409, `${JSON.stringify(milestones)} must be refused`);
    assert.match(body.message, /milestones must be an integer between 1 and 99/);
  }
  for (const run of ["", "   ", 7, null]) {
    const { status, body } = await initPost({ path: dir, run });
    assert.equal(status, 409, `${JSON.stringify(run)} must be refused`);
    assert.match(body.message, /run must be a non-empty name/);
  }
  for (const force of ["yes", 1, null]) {
    const { status, body } = await initPost({ path: dir, force });
    assert.equal(status, 409, `${JSON.stringify(force)} must be refused`);
    assert.match(body.message, /force must be true or false/);
  }
  assert.ok(!existsSync(layoutFor(dir).dir), "not one of those may have scaffolded anything");
});

test("init needs a write-enabled panel, the key, and the machine scope", async () => {
  const dir = emptyDir();

  const ro = await initPost({ path: dir, run: "read-only" }, readOnlyBase);
  assert.equal(ro.status, 403, "a read-only panel refuses it like every other mutation");

  const anon = await fetch(`${base}/api/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: dir, run: "anonymous" }),
  });
  assert.equal(anon.status, 401);

  const crossOrigin = await fetch(`${base}/api/init?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example.com" },
    body: JSON.stringify({ path: dir, run: "cross-origin" }),
  });
  assert.equal(crossOrigin.status, 403, "the Origin check covers this route like any other POST");

  assert.ok(!existsSync(layoutFor(dir).dir), "none of the three reached init");

  // A panel serving one project has no hub and no projects file: init belongs to the machine panel.
  const scaffolded = emptyDir();
  assert.equal((await initPost({ path: scaffolded, run: "project-scope", milestones: 1 })).status, 200);
  const layout = layoutFor(scaffolded);
  const project = createPanel({
    scope: { kind: "project", ctx: { config: loadConfig(layout.config, layout.projectRoot), layout, cliPath: "" } },
    port: 0,
    token: TOKEN,
    allowWrites: true,
  });
  await new Promise<void>((r) => project.listen(0, "127.0.0.1", r));
  try {
    const pBase = `http://127.0.0.1:${(project.address() as AddressInfo).port}`;
    const res = await initPost({ path: emptyDir(), run: "nope" }, pBase);
    assert.equal(res.status, 404);
  } finally {
    project.close();
  }
});

test("the hub carries the init form and the page posts it to /api/init", () => {
  for (const id of ["initPath", "initRun", "initCount", "initForce", "initForceBox", "initCard"]) {
    assert.ok(PAGE.includes(`id="${id}"`), `the page must carry ${id}`);
  }
  assert.ok(PAGE.includes("doInit()"), "the form must be reachable from a button");
  assert.ok(PAGE.includes('api("/api/init")'), "and it must post to the endpoint");
  assert.ok(PAGE.includes('id="initForce" style="display:none'), "the force box starts hidden");
  assert.ok(/a\.forceable[\s\S]{0,120}display = "block"/.test(PAGE), "and is surfaced only by a refusal that force answers");

  const doInit = PAGE.match(/async function doInit\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  for (const field of ["initPath", "initRun", "initCount", "initForceBox"]) {
    assert.ok(doInit.includes(field), `doInit must read ${field}`);
  }
  for (const key of ["path", "run", "milestones", "force"]) {
    assert.ok(new RegExp(`body\\.${key}\\s*=|\\{ ${key} \\}`).test(doInit), `doInit must send ${key}`);
  }
});
