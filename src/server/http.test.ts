import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { defaultConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { ensureDir } from "../util/fs.js";
import type { RunState } from "../types.js";
import { createPanel } from "./http.js";

const TOKEN = "test-token-value";

function scaffold(): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-http-"));
  const layout = layoutFor(root);
  ensureDir(layout.logs);
  const state: RunState = {
    run: "http-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 3,
    milestones: [
      { id: "M01", title: "First", prompt: "M01.md", status: "blocked", attempts: 1, evidence: ["AC1: ok"],
        diagnosis: { symptom: "port busy", tried: [], userAction: "free the port" },
        history: [
          { attempt: 1, startedAt: new Date(0).toISOString(), endedAt: new Date(1000).toISOString(), seconds: 1,
            exitCode: 0, transcript: "M01-a.log", outcome: "blocked", detail: "d", steering: "s", agent: "claude" },
        ] },
    ],
  };
  writeFileSync(layout.state, JSON.stringify(state));
  writeFileSync(join(layout.logs, "M01-a.log"), "transcript body");
  return layout;
}

const layout = scaffold();
const config = defaultConfig("http-test", layout.projectRoot);
let base = "";
let readOnlyBase = "";

let attachedBase = "";

const scope = { kind: "project", ctx: { config, layout, cliPath: "" } } as const;
const panel = createPanel({ scope, port: 0, token: TOKEN, allowWrites: true });
const readOnly = createPanel({ scope, port: 0, token: TOKEN, allowWrites: false });
const attached = createPanel({ scope, port: 0, token: TOKEN, allowWrites: true, allowStart: false });

before(async () => {
  await new Promise<void>((r) => panel.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => readOnly.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => attached.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  readOnlyBase = `http://127.0.0.1:${(readOnly.address() as AddressInfo).port}`;
  attachedBase = `http://127.0.0.1:${(attached.address() as AddressInfo).port}`;
});
after(() => {
  panel.close();
  readOnly.close();
  attached.close();
});

const get = (path: string, init?: RequestInit) => fetch(base + path, init);

test("no token, a wrong token and a truncated token are all refused", async () => {
  assert.equal((await get("/api/state")).status, 401);
  assert.equal((await get("/api/state?token=nope")).status, 401);
  assert.equal((await get(`/api/state?token=${TOKEN.slice(0, -1)}`)).status, 401);
  assert.equal((await get(`/api/state?token=${TOKEN}`)).status, 200);
});

test("the token is accepted as a bearer header, so it can stay out of the URL", async () => {
  const res = await get("/api/state", { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
});

// fetch refuses to set Host - it is a forbidden header name - so this one goes out over raw http.
function rawGet(path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: (panel.address() as AddressInfo).port, path, method: "GET", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("a Host header we did not expect is refused before anything else happens", async () => {
  assert.equal(await rawGet(`/api/state?token=${TOKEN}`, "evil.example.com"), 403);
  assert.equal(await rawGet(`/api/state?token=${TOKEN}`, "127.0.0.1.evil.com"), 403);
  assert.equal(await rawGet(`/api/state?token=${TOKEN}`, "127.0.0.1"), 200, "our own name still works");
});

test("a cross-origin write is refused even with a valid token", async () => {
  const res = await get(`/api/kill?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example.com" },
    body: "{}",
  });
  assert.equal(res.status, 403);
});

test("a transcript name cannot escape the logs directory", async () => {
  assert.equal((await get(`/api/transcript?token=${TOKEN}&name=M01-a.log`)).status, 200);
  for (const name of ["../../../../etc/passwd", "..%2f..%2fetc%2fpasswd", "/etc/passwd"]) {
    const res = await get(`/api/transcript?token=${TOKEN}&name=${encodeURIComponent(name)}`);
    assert.equal(res.status, 404, `${name} must not resolve`);
  }

  // No name at all resolves to the logs directory, which used to read as EISDIR and answer 500.
  assert.equal((await get(`/api/transcript?token=${TOKEN}`)).status, 404);
  assert.equal((await get(`/api/transcript?token=${TOKEN}&name=`)).status, 404);
});

test("the state view carries what the panel renders, including the revision to poll on", async () => {
  const d = (await (await get(`/api/state?token=${TOKEN}`)).json()) as Record<string, unknown>;
  assert.equal(d.run, "http-test");
  assert.equal(d.rev, 3);
  assert.equal(d.blocked, 1);
  assert.equal(d.writable, true);
  const milestones = d.milestones as Array<Record<string, unknown>>;
  assert.equal((milestones[0]!.diagnosis as Record<string, string>).userAction, "free the port");
});

test("a read-only panel refuses every write and says so in its state", async () => {
  const res = await fetch(`${readOnlyBase}/api/kill?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  const d = (await (await fetch(`${readOnlyBase}/api/state?token=${TOKEN}`)).json()) as { writable: boolean };
  assert.equal(d.writable, false, "the page hides its controls off this flag");
});

test("a panel attached to a run keeps every control except starting a second runner", async () => {
  const post = (b: string, path: string) =>
    fetch(`${b}${path}?token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  const start = await post(attachedBase, "/api/run/start");
  assert.equal(start.status, 409);
  assert.match((await start.json() as { message: string }).message, /a second one would be two runners on one state.json/);

  // Not a read-only panel: kill still reaches its command, which is the supervisor's rule 4 path.
  const killed = await post(attachedBase, "/api/kill");
  assert.notEqual(killed.status, 403, "kill must not be refused the way a read-only panel refuses it");
  assert.equal((await killed.json() as { message: string }).message, "nothing to kill", "no session is running in this fixture");
  const d = (await (await fetch(`${attachedBase}/api/state?token=${TOKEN}`)).json()) as Record<string, unknown>;
  assert.equal(d.writable, true);
  assert.equal(d.canStart, false, "the page hides the start button off this flag");
});

test("an unknown endpoint is a 404, not a stack trace", async () => {
  const res = await get(`/api/nope?token=${TOKEN}`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "no such endpoint" });
});

test("the page and the report are served as self-contained HTML", async () => {
  for (const path of ["/", "/api/report"]) {
    const res = await get(`${path}?token=${TOKEN}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<!doctype html>/i);
    assert.ok(!/\b(src|href)\s*=\s*["']https?:/i.test(body), `${path} must not load anything external`);
  }
});

test("the served report links back to the panel it came from, and the link works", async () => {
  const body = await (await get(`/api/report?token=${TOKEN}`)).text();
  const href = /<a href="([^"]+)">&larr; back to the panel<\/a>/.exec(body)?.[1] ?? "";
  assert.equal(href, `/?token=${TOKEN}`, "the link carries what the report's own URL carried");
  assert.match(body, /archival snapshot/, "and one line says what the report is for beside the panel");

  const back = await get(href);
  assert.equal(back.status, 200, "following it lands on the panel, still authenticated");
  assert.match(await back.text(), /id="reportLink"/, "which is the page the report link lives on");
});

test("a report reached with a cookie sends the browser back without putting the key in its history", async () => {
  const minted = await get("/api/once", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: "{}",
  });
  const { once } = (await minted.json()) as { once: string };
  const cookie = (await get(`/auth?once=${once}`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] ?? "";

  const body = await (await get("/api/report", { headers: { cookie } })).text();
  const href = /<a href="([^"]+)">&larr; back to the panel<\/a>/.exec(body)?.[1] ?? "";
  assert.equal(href, "/", "no token was in the URL, so none is carried into the back link");
  assert.ok(!body.includes(TOKEN), "the key never reaches the page it did not arrive on");
  assert.equal((await get(href, { headers: { cookie } })).status, 200, "the cookie is what authenticates the way back");
});

test("a once-token opens a session as a cookie, once, and the URL that did it is dead", async () => {
  const minted = await get("/api/once", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(minted.status, 200);
  const { once } = (await minted.json()) as { once: string };
  assert.ok(once && once !== TOKEN, "the once-token must not be the key itself");

  const exchanged = await get(`/auth?once=${once}`, { redirect: "manual" });
  assert.equal(exchanged.status, 303);
  const cookie = exchanged.headers.get("set-cookie") ?? "";
  assert.match(cookie, /milestoner_token=/);
  assert.match(cookie, /HttpOnly/);

  const viaCookie = await get("/api/state", { headers: { cookie: cookie.split(";")[0]! } });
  assert.equal(viaCookie.status, 200, "the cookie is a full credential from then on");

  assert.equal((await get(`/auth?once=${once}`, { redirect: "manual" })).status, 401, "a once-token spends itself");
  assert.equal((await get("/auth?once=guessing", { redirect: "manual" })).status, 401);
  assert.equal((await get("/auth", { redirect: "manual" })).status, 401);
});

test("minting a once-token still needs the real key", async () => {
  const res = await get("/api/once", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
});

function machineProject(run: string): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-machine-"));
  const l = layoutFor(root);
  ensureDir(l.logs);
  const state: RunState = {
    run,
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 1,
    milestones: [
      { id: "M01", title: "Only", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] },
    ],
  };
  writeFileSync(l.state, JSON.stringify(state));
  writeFileSync(l.config, JSON.stringify({ run, agent: { command: "claude", args: [], modelArgs: [], model: null, env: {} }, infra: {} }));
  return l;
}

test("a machine panel answers for every registered run, one root at a time", async () => {
  const a = machineProject("machine-a");
  const b = machineProject("machine-b");
  const registryFile = join(mkdtempSync(join(tmpdir(), "milestoner-mreg-")), "runs.json");
  const now = new Date().toISOString();
  writeFileSync(
    registryFile,
    JSON.stringify({
      runs: [
        { pid: process.pid, run: "machine-a", projectRoot: a.projectRoot, startedAt: now, lastSeen: now },
        { pid: process.pid, run: "machine-b", projectRoot: b.projectRoot, startedAt: now, lastSeen: now },
      ],
    }),
  );

  const machine = createPanel({
    scope: { kind: "machine", registry: registryFile, projects: join(mkdtempSync(join(tmpdir(), "milestoner-mproj-")), "projects.json"), cliPath: "" },
    port: 0,
    token: TOKEN,
    allowWrites: true,
  });
  await new Promise<void>((r) => machine.listen(0, "127.0.0.1", r));
  const mBase = `http://127.0.0.1:${(machine.address() as AddressInfo).port}`;
  const mGet = (path: string, init?: RequestInit) =>
    fetch(`${mBase}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init?.headers } });

  try {
    const hub = (await (await mGet("/api/state")).json()) as { hub: boolean; runs: Array<{ run: string }> };
    assert.equal(hub.hub, true, "no root means the view across runs");
    assert.deepEqual(hub.runs.map((r) => r.run).sort(), ["machine-a", "machine-b"]);

    const one = await mGet(`/api/state?root=${encodeURIComponent(a.projectRoot)}`);
    assert.equal(one.status, 200);
    const d = (await one.json()) as { run: string; hub: boolean; runs: unknown[]; canStart: boolean };
    assert.equal(d.run, "machine-a");
    assert.equal(d.hub, false);
    assert.equal(d.runs.length, 2, "the run view still carries the listing, for the switcher");
    assert.equal(d.canStart, true, "no runner owns the machine panel, so starting is offered");

    assert.equal((await mGet("/api/state?root=" + encodeURIComponent("C:/nowhere/at-all"))).status, 404);

    const steered = await mGet(`/api/steer?root=${encodeURIComponent(b.projectRoot)}`, {
      method: "POST",
      body: JSON.stringify({ text: "prefer the small fix" }),
    });
    assert.equal(steered.status, 200);
    assert.match(readFileSync(b.steering, "utf8"), /prefer the small fix/, "the write lands in the project the root names");

    const rootless = await mGet("/api/steer", { method: "POST", body: JSON.stringify({ text: "nope" }) });
    assert.equal(rootless.status, 404, "a machine panel refuses a write that names no run");

    const reported = await (await mGet(`/api/report?root=${encodeURIComponent(a.projectRoot)}`)).text();
    const href = /<a href="([^"]+)">&larr; back to the panel<\/a>/.exec(reported)?.[1] ?? "";
    // The same serializer panelHref uses: URLSearchParams percent-encodes characters
    // encodeURIComponent leaves alone (a Windows 8.3 temp path carries a "~").
    assert.equal(
      href,
      `/?${new URLSearchParams({ root: a.projectRoot })}`.replaceAll("&", "&amp;"),
      "on a machine panel the way back names the run the report is of",
    );

    // A clean exit deregisters (D-025); the panel must keep showing what it watched finish.
    writeFileSync(registryFile, JSON.stringify({ runs: [] }));
    const after = (await (await mGet("/api/state")).json()) as { runs: Array<{ run: string; health: string }> };
    assert.deepEqual(after.runs.map((r) => r.run).sort(), ["machine-a", "machine-b"], "deregistered runs stay for the panel's lifetime");
    assert.ok(after.runs.every((r) => r.health === "gone"), "with no pulse and no entry, the honest verdict is gone");
    const still = await mGet(`/api/state?root=${encodeURIComponent(a.projectRoot)}`);
    assert.equal(still.status, 200, "the per-run view of a finished run still resolves");
  } finally {
    machine.close();
    machine.closeAllConnections();
  }
});

test("a project known only from the projects file is listed, and can be written to", async () => {
  const filed = machineProject("filed-away");
  const gone = machineProject("deleted-since");
  const home = mkdtempSync(join(tmpdir(), "milestoner-mhome-"));
  const registryFile = join(home, "runs.json");
  const projectsFile = join(home, "projects.json");
  writeFileSync(registryFile, JSON.stringify({ runs: [] }));
  const now = new Date().toISOString();
  writeFileSync(
    projectsFile,
    JSON.stringify({ projects: [{ root: filed.projectRoot, lastSeen: now }, { root: gone.projectRoot, lastSeen: now }] }),
  );
  rmSync(gone.projectRoot, { recursive: true, force: true });

  const machine = createPanel({
    scope: { kind: "machine", registry: registryFile, projects: projectsFile, cliPath: "" },
    port: 0,
    token: TOKEN,
    allowWrites: true,
  });
  await new Promise<void>((r) => machine.listen(0, "127.0.0.1", r));
  const mBase = `http://127.0.0.1:${(machine.address() as AddressInfo).port}`;
  const mGet = (path: string, init?: RequestInit) =>
    fetch(`${mBase}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init?.headers } });

  try {
    const hub = (await (await mGet("/api/state")).json()) as { runs: Array<{ run: string; health: string }> };
    assert.deepEqual(
      hub.runs.map((r) => r.run),
      ["filed-away"],
      "no registry entry and no runner this panel watched: the file is the only thing that knows it exists",
    );
    assert.equal(hub.runs[0]?.health, "unknown", "nothing died here, so it must not read as a gone runner");

    const one = await mGet(`/api/state?root=${encodeURIComponent(filed.projectRoot)}`);
    assert.equal(one.status, 200, "contextFor must resolve a project the file alone put in the listing");

    const steered = await mGet(`/api/steer?root=${encodeURIComponent(filed.projectRoot)}`, {
      method: "POST",
      body: JSON.stringify({ text: "steered through the projects file" }),
    });
    assert.equal(steered.status, 200);
    assert.match(readFileSync(filed.steering, "utf8"), /steered through the projects file/);

    writeFileSync(projectsFile, "{ not json at all");
    const corrupt = (await (await mGet("/api/state")).json()) as { runs: unknown[] };
    assert.deepEqual(corrupt.runs, [], "a corrupt file costs the listing those projects, not the panel");
  } finally {
    machine.close();
    machine.closeAllConnections();
  }
});

test("the page only reads fields the state view actually sends", async () => {
  // The page and the payload are edited in different files and fail silently when they drift:
  // a renamed key renders "undefined" rather than throwing.
  const page = readFileSync(new URL("./page.ts", import.meta.url), "utf8");
  const d = (await (await get(`/api/state?token=${TOKEN}`)).json()) as Record<string, unknown>;

  // `error` and `message` come from action responses, not from the state view.
  const fromActions = new Set(["error", "message"]);
  const readsTop = new Set([...page.matchAll(/\bd\.([a-zA-Z]+)/g)].map((m) => m[1]!));
  for (const key of readsTop) {
    if (fromActions.has(key)) continue;
    assert.ok(key in d, `the page reads d.${key}, which the state view does not send`);
  }

  const milestone = (d.milestones as Array<Record<string, unknown>>)[0]!;
  for (const [, key] of page.matchAll(/\bm\.([a-zA-Z]+)/g)) {
    assert.ok(key! in milestone, `the page reads m.${key}, which a milestone does not carry`);
  }

  const attempt = (milestone.history as Array<Record<string, unknown>>)[0]!;
  for (const [, key] of page.matchAll(/\bh\.([a-zA-Z]+)/g)) {
    assert.ok(key! in attempt, `the page reads h.${key}, which an attempt record does not carry`);
  }

  const pulseKeys = ["milestoneId", "attempt", "lastEvent", "sessionSeconds", "agent", "transcript", "runnerAlive"];
  for (const [, key] of page.matchAll(/\bp\.([a-zA-Z]+)/g)) {
    assert.ok(pulseKeys.includes(key!), `the page reads p.${key}, which the pulse does not carry`);
  }
});
