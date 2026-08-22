import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { init } from "../commands/init.js";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "start-test-token";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(path: string, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end && !existsSync(path)) await delay(50);
  return existsSync(path);
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

/** A scaffolded run with two pending milestones, an argv-recording CLI and a recording adapter. */
function scaffold(): { layout: ReturnType<typeof layoutFor>; cliPath: string; marker: string; attendMarker: string } {
  const root = mkdtempSync(join(tmpdir(), "milestoner-start-"));
  assert.equal(quietly(() => init({ projectRoot: root, run: "start-api", count: 2, force: false })), 0);
  const layout = layoutFor(root);

  const marker = join(root, "spawned.txt");
  const cliPath = join(root, "fake-cli.cjs");
  writeFileSync(cliPath, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`);

  const attendMarker = join(root, "attended.txt");
  const adapter = join(root, "fake-adapter.cjs");
  writeFileSync(adapter, `require("node:fs").writeFileSync(${JSON.stringify(attendMarker)}, String(process.argv[2]));`);
  const config = JSON.parse(readFileSync(layout.config, "utf8")) as Record<string, unknown>;
  config.environment = { attendCommand: `node "${adapter}" {{seconds}}`, attendSeconds: 90 };
  writeFileSync(layout.config, JSON.stringify(config, null, 2));

  return { layout, cliPath, marker, attendMarker };
}

const fixture = scaffold();
const panel = createPanel({
  scope: { kind: "project", ctx: { config: loadConfig(fixture.layout.config, fixture.layout.projectRoot), layout: fixture.layout, cliPath: fixture.cliPath } },
  port: 0,
  token: TOKEN,
  allowWrites: true,
});
let base = "";

before(async () => {
  await new Promise<void>((r) => panel.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
});
after(() => panel.close());

const post = (path: string, body: Record<string, unknown>) =>
  fetch(`${base}${path}?token=${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The fixture run is scaffold-dirty, so every start that is meant to spawn carries the bypass. */
const start = (body: Record<string, unknown>) => post("/api/run/start", { noLint: true, ...body });

function forget(path: string): void {
  rmSync(path, { force: true });
}

async function spawnedArgs(): Promise<string> {
  assert.ok(await waitFor(fixture.marker), "the runner must actually be spawned");
  return readFileSync(fixture.marker, "utf8");
}

test("every start option reaches the runner as the flag the CLI takes", async () => {
  forget(fixture.marker);
  const res = await start({ milestone: "M02", once: true, maxAttempts: 5, model: "opus" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);
  assert.equal(await spawnedArgs(), "run --milestone M02 --once --max-attempts 5 --model opus --no-lint");
});

test("only the options that were sent become flags", async () => {
  forget(fixture.marker);
  assert.equal((await start({ model: "sonnet" })).status, 200);
  assert.equal(await spawnedArgs(), "run --model sonnet --no-lint");

  forget(fixture.marker);
  assert.equal((await start({})).status, 200);
  assert.equal(await spawnedArgs(), "run --no-lint", "an optionless start is the command it always was");
});

test("maxAttempts must be a positive integer, and a bad one spawns nothing", async () => {
  forget(fixture.marker);
  for (const maxAttempts of [0, -1, 2.5, "3", null]) {
    const res = await start({ maxAttempts });
    assert.equal(res.status, 409, `${JSON.stringify(maxAttempts)} must be refused`);
    const body = (await res.json()) as { ok: boolean; message: string };
    assert.equal(body.ok, false);
    assert.match(body.message, /maxAttempts/, "the message names the field");
  }
  await delay(400);
  assert.ok(!existsSync(fixture.marker), "a refused start must not spawn a runner");
});

test("an empty or unknown milestone is refused before anything is spawned", async () => {
  forget(fixture.marker);
  for (const milestone of ["", "   ", 7, null]) {
    const res = await start({ milestone });
    assert.equal(res.status, 409, `${JSON.stringify(milestone)} must be refused`);
    assert.match(((await res.json()) as { message: string }).message, /milestone must be the id/);
  }

  const unknown = await start({ milestone: "M99" });
  assert.equal(unknown.status, 409);
  assert.match(((await unknown.json()) as { message: string }).message, /no milestone with id "M99"/);

  await delay(400);
  assert.ok(!existsSync(fixture.marker), "a refused start must not spawn a runner");
});

test("a non-string model and a non-boolean once are refused, naming the field", async () => {
  forget(fixture.marker);
  for (const model of [7, true, "", "  "]) {
    const res = await start({ model });
    assert.equal(res.status, 409, `${JSON.stringify(model)} must be refused`);
    assert.match(((await res.json()) as { message: string }).message, /model must be a non-empty string/);
  }

  const once = await start({ once: "yes" });
  assert.equal(once.status, 409);
  assert.match(((await once.json()) as { message: string }).message, /once must be true or false/);

  await delay(400);
  assert.ok(!existsSync(fixture.marker), "a refused start must not spawn a runner");
});

test("/api/attend forwards the seconds it is given, and falls back to the configured default", async () => {
  forget(fixture.attendMarker);
  const res = await post("/api/attend", { seconds: 42 });
  assert.equal(res.status, 200);
  assert.ok(await waitFor(fixture.attendMarker));
  assert.equal(readFileSync(fixture.attendMarker, "utf8"), "42", "the seconds reach the adapter's command line");

  forget(fixture.attendMarker);
  assert.equal((await post("/api/attend", {})).status, 200);
  assert.ok(await waitFor(fixture.attendMarker));
  assert.equal(readFileSync(fixture.attendMarker, "utf8"), "90", "no seconds means environment.attendSeconds");
});

test("the page carries the start form and the attend seconds input", async () => {
  for (const id of ["optMilestone", "optOnce", "optAttempts", "optModel", "attendSeconds"]) {
    assert.ok(PAGE.includes(`id="${id}"`), `the page must carry ${id}`);
  }
  assert.ok(PAGE.includes("toggleStartOptions()"), "the start options must be reachable from the controls");

  // The body builder only touches the DOM through getElementById, so a stub map exercises it here.
  const src = PAGE.match(/const field = .*\nfunction startBody\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, "the page must carry startBody");
  const build = (els: Record<string, unknown>) =>
    (new Function("document", `${src}\nreturn startBody;`)({ getElementById: (id: string) => els[id] ?? null }) as () => Record<string, unknown>)();

  assert.deepEqual(
    build({ optMilestone: { value: "M02" }, optOnce: { checked: true }, optAttempts: { value: "4" }, optModel: { value: " opus " } }),
    { milestone: "M02", once: true, maxAttempts: 4, model: "opus" },
  );
  assert.deepEqual(build({}), {}, "an untouched form posts nothing, so the CLI defaults stand");
});
