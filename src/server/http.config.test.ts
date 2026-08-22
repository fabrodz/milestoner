import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import type { MilestonerConfig, RunState } from "../types.js";
import { ensureDir } from "../util/fs.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "config-test-token";

/** The document as a hand-edited file looks: only the keys a person writes, pretty-printed. */
const ON_DISK = {
  run: "config-test",
  maxAttempts: 3,
  agent: { command: "claude", args: ["-p", "{{kickoff}}"], modelArgs: ["--model", "{{model}}"], model: null, env: {} },
  models: { M01: "sonnet" },
  infra: { deathSeconds: 90 },
  liveness: ["src"],
  environment: { attendCommand: null, attendSeconds: 120 },
};

function scaffold(): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-config-"));
  const layout = layoutFor(root);
  ensureDir(layout.logs);
  const state: RunState = {
    run: "config-test",
    createdAt: new Date(0).toISOString(),
    runComplete: false,
    rev: 1,
    milestones: [
      { id: "M01", title: "First", prompt: "M01.md", status: "pending", attempts: 0, evidence: [], history: [] },
      { id: "M02", title: "Second", prompt: "M02.md", status: "pending", attempts: 0, evidence: [], history: [] },
    ],
  };
  writeFileSync(layout.state, JSON.stringify(state));
  writeFileSync(layout.config, JSON.stringify(ON_DISK, null, 2) + "\n");
  return layout;
}

const layout = scaffold();
const ctx = { config: loadConfig(layout.config, layout.projectRoot), layout, cliPath: "" };
const scope = { kind: "project", ctx } as const;
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

interface Reply {
  ok: boolean;
  message: string;
}

const getConfig = (at = base) => fetch(`${at}/api/config?token=${TOKEN}`);

async function saveConfig(content: unknown, at = base): Promise<{ status: number; body: Reply }> {
  const res = await fetch(`${at}/api/config?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return { status: res.status, body: (await res.json()) as Reply };
}

const onDisk = () => readFileSync(layout.config, "utf8");
const parsed = () => JSON.parse(onDisk()) as Record<string, unknown>;

test("the config file is served exactly as it is on disk", async () => {
  const res = await getConfig();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/, "the editor gets the text, not a re-encoding");
  assert.equal(await res.text(), onDisk(), "byte for byte, so what is edited is what is there");
});

test("a valid save replaces the file atomically and the panel answers from the new config", async () => {
  const before = parsed();
  const next = { ...(before as unknown as typeof ON_DISK), maxAttempts: 7, models: { M01: "sonnet", M02: "opus" } };
  const { status, body } = await saveConfig(JSON.stringify(next, null, 2));

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /applies to the next one|next/, "the reply says a live runner keeps the config it started with");

  const after = parsed();
  assert.equal(after.maxAttempts, 7, "the edit is on disk");
  assert.deepEqual(after.models, { M01: "sonnet", M02: "opus" }, "and so is the per-milestone model map");
  assert.equal((await (await getConfig()).text()).trimEnd(), onDisk().trimEnd(), "a re-read serves what was written");

  const leftovers = readdirSync(layout.dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "writeJsonAtomic renames a sibling temp file into place and leaves nothing behind");

  const view = (await (await fetch(`${base}/api/state?token=${TOKEN}`)).json()) as {
    maxAttempts: number;
    milestones: Array<{ id: string; model: string | null }>;
  };
  assert.equal(view.maxAttempts, 7, "a panel that resolved its config once must not answer from the stale copy");
  assert.deepEqual(
    view.milestones.map((m) => [m.id, m.model]),
    [["M01", "sonnet"], ["M02", "opus"]],
    "the milestone cards read their model field off this",
  );

  // Clearing the entry is how the page's empty model field removes a milestone from the map.
  const cleared = await saveConfig(JSON.stringify({ ...next, models: { M01: "sonnet" } }, null, 2));
  assert.equal(cleared.status, 200);
  assert.deepEqual(parsed().models, { M01: "sonnet" });
});

test("invalid JSON is refused with the parser's own message and the file is untouched", async () => {
  const before = onDisk();
  for (const content of ["{ not json at all", "", "   ", "[1,2,3]", '"just a string"', "null", 7, null]) {
    const { status, body } = await saveConfig(content);
    assert.equal(status, 409, `${JSON.stringify(content)} must be refused`);
    assert.equal(body.ok, false);
    assert.match(body.message, /not valid JSON|must be a JSON object|content is required/);
  }
  assert.equal(onDisk(), before, "not one of those may have touched the file");
});

test("a config missing a required field is refused with the loader's own message, byte for byte untouched", async () => {
  const before = onDisk();
  for (const key of ["run", "agent", "infra"] as const) {
    const doc: Record<string, unknown> = { ...ON_DISK };
    delete doc[key];
    const { status, body } = await saveConfig(JSON.stringify(doc));
    assert.equal(status, 409, `a document without "${key}" must be refused`);
    assert.equal(
      body.message,
      `${layout.config}: missing required field "${key}"`,
      "the validator's own sentence, not a second one written for the panel",
    );
    assert.equal(onDisk(), before, "the file survives the refusal unchanged");
  }

  // The refusal is exactly what the next runner would have hit: loadConfig still reads the old file.
  assert.doesNotThrow(() => loadConfig(layout.config, layout.projectRoot));
});

test("projectRoot is never written into the file, however hard the editor asks", async () => {
  const { status } = await saveConfig(JSON.stringify({ ...ON_DISK, projectRoot: "C:/somewhere/else" }, null, 2));
  assert.equal(status, 200, "it is dropped, not refused: an exported document carries it and is otherwise fine");
  assert.ok(!("projectRoot" in parsed()), "config.json records where it was found nowhere but its own location");

  const reloaded: MilestonerConfig = loadConfig(layout.config, layout.projectRoot);
  assert.equal(reloaded.projectRoot, layout.projectRoot);
});

test("the config endpoint needs the key, the Origin and a write-enabled panel", async () => {
  const before = onDisk();

  const ro = await saveConfig(JSON.stringify(ON_DISK), readOnlyBase);
  assert.equal(ro.status, 403, "a read-only panel refuses it like every other mutation");
  assert.equal((await getConfig(readOnlyBase)).status, 200, "reading it is not a mutation");

  const anon = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: JSON.stringify(ON_DISK) }),
  });
  assert.equal(anon.status, 401);
  assert.equal((await fetch(`${base}/api/config`)).status, 401, "and reading it needs the key too");

  const crossOrigin = await fetch(`${base}/api/config?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.example.com" },
    body: JSON.stringify({ content: JSON.stringify(ON_DISK) }),
  });
  assert.equal(crossOrigin.status, 403, "the Origin check covers this route like any other POST");

  assert.equal(onDisk(), before, "none of the three reached the file");
});

test("the run view carries the config editor and a model field per milestone", () => {
  for (const id of ["configCard", "configText", "configError", "configNote"]) {
    assert.ok(PAGE.includes(`id="${id}"`), `the page must carry ${id}`);
  }
  assert.ok(PAGE.includes("saveConfig()"), "the editor must be reachable from a button");
  assert.ok(PAGE.includes('api("/api/config")'), "and it must talk to the endpoint");
  assert.ok(/configNote[\s\S]{0,200}applies to the next one/.test(PAGE), "the note about a live runner must be on the card");
  assert.ok(/configProblem\(a\.message/.test(PAGE), "a refusal is shown inline, not only as a toast");

  assert.ok(PAGE.includes(`id="model-' + esc(m.id) +`), "each milestone card carries its own model input");
  assert.ok(PAGE.includes("saveModel(this.dataset.id)"), "with a save beside it");
  assert.ok(PAGE.includes('value="' + "' + esc(m.model || \"\") +"), "prefilled from the map, empty when unset");
});

test("the model field sends the whole document back with only that milestone's key changed", async () => {
  // saveModel reaches the world through getElementById and fetch alone, so stubs exercise it here.
  const grab = (head: string): string => {
    const found = PAGE.match(new RegExp(head + "[\\s\\S]*?\\n\\}"));
    assert.ok(found, `the page must carry ${head}`);
    return found[0];
  };
  const src = `let lastMilestones = "";\n${grab("async function fetchConfig\\(\\)")}\n${grab("async function saveModel\\(id\\)")}`;

  let stored = JSON.stringify({ run: "config-test", agent: {}, infra: {}, models: { M01: "sonnet" } }, null, 2);
  let typed = "";
  const fakeFetch = async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method !== "POST") return { ok: true, text: async () => stored, json: async () => ({}) };
    stored = (JSON.parse(init.body ?? "{}") as { content: string }).content;
    return { ok: true, json: async () => ({ ok: true, message: "config saved" }) };
  };
  const saveModel = new Function("document", "api", "auth", "fetch", "toast", "loadConfigText", `${src}\nreturn saveModel;`)(
    { getElementById: (id: string) => (id === "model-M02" ? { value: typed } : null) },
    (p: string) => p,
    {},
    fakeFetch,
    () => {},
    async () => {},
  ) as (id: string) => Promise<void>;

  typed = " opus ";
  await saveModel("M02");
  assert.deepEqual(JSON.parse(stored).models, { M01: "sonnet", M02: "opus" }, "the entry is added, trimmed");
  assert.equal(JSON.parse(stored).run, "config-test", "and everything else goes back exactly as it came");

  typed = "   ";
  await saveModel("M02");
  assert.deepEqual(JSON.parse(stored).models, { M01: "sonnet" }, "an emptied field removes the entry, it does not blank it");
});
