import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { init } from "../commands/init.js";
import { lint } from "../commands/lint.js";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import type { RunState } from "../types.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "lint-test-token";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(path: string, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && !existsSync(path)) await delay(50);
  return existsSync(path);
}

function capture(fn: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { code: fn(), out: lines.join("\n").replaceAll(/\x1b\[\d+m/g, "") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** A run straight out of init: template residue everywhere, both milestones pending. */
function scaffoldDirty(run: string): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-lintapi-"));
  const scaffolded = capture(() => init({ projectRoot: root, run, count: 2, force: false }).code);
  assert.equal(scaffolded.code, 0, "the scaffold must succeed");
  return layoutFor(root);
}

/** startRun spawns node with the ctx's cliPath; this one writes its argv and exits. */
function markedCli(layout: ReturnType<typeof layoutFor>): { cliPath: string; marker: string } {
  const marker = join(layout.projectRoot, "spawned.txt");
  const cliPath = join(layout.projectRoot, "fake-cli.cjs");
  writeFileSync(cliPath, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`);
  return { cliPath, marker };
}

function panelFor(layout: ReturnType<typeof layoutFor>, cliPath: string) {
  const config = loadConfig(layout.config, layout.projectRoot);
  return createPanel({ scope: { kind: "project", ctx: { config, layout, cliPath } }, port: 0, token: TOKEN, allowWrites: true });
}

const dirty = scaffoldDirty("lint-api");
const dirtyCli = markedCli(dirty);
const dirtyPanel = panelFor(dirty, dirtyCli.cliPath);
let dirtyBase = "";

// The same dirt, but on milestones this run will never execute: done and blocked, none pending.
const finished = scaffoldDirty("lint-api-finished");
const finishedCli = markedCli(finished);
{
  const state = JSON.parse(readFileSync(finished.state, "utf8")) as RunState;
  state.milestones[0]!.status = "done";
  state.milestones[1]!.status = "blocked";
  writeFileSync(finished.state, JSON.stringify(state));
}
const finishedPanel = panelFor(finished, finishedCli.cliPath);
let finishedBase = "";

before(async () => {
  await new Promise<void>((r) => dirtyPanel.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => finishedPanel.listen(0, "127.0.0.1", r));
  dirtyBase = `http://127.0.0.1:${(dirtyPanel.address() as AddressInfo).port}`;
  finishedBase = `http://127.0.0.1:${(finishedPanel.address() as AddressInfo).port}`;
});
after(() => {
  dirtyPanel.close();
  finishedPanel.close();
});

const start = (base: string, body: Record<string, unknown>) =>
  fetch(`${base}/api/run/start?token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/lint returns the same findings milestoner lint --json prints for the run", async () => {
  const cli = capture(() => lint({ config: loadConfig(dirty.config, dirty.projectRoot), layout: dirty, json: true }));
  assert.equal(cli.code, 1, "the fixture must be dirty");

  const res = await fetch(`${dirtyBase}/api/lint?token=${TOKEN}`);
  assert.equal(res.status, 200);
  const fromApi = (await res.json()) as { run: string; errors: number; warnings: number; findings: unknown[] };
  assert.deepEqual(fromApi, JSON.parse(cli.out), "one core, one shape: the endpoint and the CLI must not drift");
  assert.equal(fromApi.run, "lint-api");
  assert.ok(fromApi.errors > 0);
  assert.equal(fromApi.findings.length, fromApi.errors + fromApi.warnings);
});

test("/api/lint is not reachable unauthenticated", async () => {
  assert.equal((await fetch(`${dirtyBase}/api/lint`)).status, 401);
  assert.equal((await fetch(`${dirtyBase}/api/lint?token=wrong`)).status, 401);
});

test("run/start on a dirty run refuses with the counts and spawns nothing", async () => {
  const res = await start(dirtyBase, {});
  assert.equal(res.status, 409);
  const body = (await res.json()) as { ok: boolean; message: string; lintRefused?: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.lintRefused, true, "the panel offers the deliberate bypass off this flag");
  assert.match(body.message, /\d+ errors?, \d+ warnings?/, "the counts ride in the message");
  assert.match(body.message, /pending milestones/);
  assert.match(body.message, /M01 [a-z-]+:/, "the first findings ride in the message");

  await delay(400);
  assert.ok(!existsSync(dirtyCli.marker), "a refused start must not spawn a runner");
});

test("run/start with noLint: true proceeds and passes --no-lint to the runner", async () => {
  const res = await start(dirtyBase, { noLint: true });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);
  assert.ok(await waitFor(dirtyCli.marker), "the runner must actually be spawned");
  assert.equal(readFileSync(dirtyCli.marker, "utf8"), "run --no-lint", "the flag must reach the runner so the run log records the bypass");
});

test("findings on done or blocked milestones do not refuse a start, matching the runner's gate", async () => {
  const res = await start(finishedBase, {});
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true, "errors on milestones this run will not execute never gate");
  assert.ok(await waitFor(finishedCli.marker));
  assert.equal(readFileSync(finishedCli.marker, "utf8"), "run", "no bypass flag on a start the gate allowed");
});

test("the page's lint card renders the counts and the findings the endpoint returns", async () => {
  assert.ok(PAGE.includes('id="lintCard"'), "the page must carry the lint card");
  assert.ok(PAGE.includes('id="lintRefusal"'), "the page must carry the refusal box");

  // The card builder is pure on purpose; rendering it here proves the markup without a browser.
  const escSrc = PAGE.match(/const esc = .*$/m)?.[0];
  const fnSrc = PAGE.match(/function lintCardHtml\(L\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(escSrc && fnSrc, "the page must carry lintCardHtml");
  const render = new Function(`${escSrc}\n${fnSrc}\nreturn lintCardHtml;`)() as (L: unknown) => string;

  const data = (await (await fetch(`${dirtyBase}/api/lint?token=${TOKEN}`)).json()) as { errors: number; warnings: number };
  const html = render(data);
  assert.match(html, new RegExp(`${data.errors} errors?, ${data.warnings} warnings?`), "the counts are on the card");
  assert.match(html, /template-residue/, "the findings are on the card");
  assert.match(html, /M01/, "per-milestone grouping survives into the markup");

  const clean = render({ run: "x", errors: 0, warnings: 0, findings: [] });
  assert.match(clean, /clean/);
  assert.match(clean, /0 errors, 0 warnings/);
});
