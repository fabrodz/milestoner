import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "dogwatch-http-"));
  const layout = layoutFor(root);
  ensureDir(layout.logs);
  const state: RunState = {
    run: "http-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 3,
    milestones: [
      { id: "M01", title: "First", prompt: "M01.md", status: "blocked", attempts: 1, evidence: ["AC1: ok"],
        diagnosis: { symptom: "port busy", tried: [], userAction: "free the port" }, history: [] },
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

const panel = createPanel({ ctx: { config, layout, cliPath: "" }, port: 0, token: TOKEN, allowWrites: true });
const readOnly = createPanel({ ctx: { config, layout, cliPath: "" }, port: 0, token: TOKEN, allowWrites: false });

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
});
