import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { init } from "../commands/init.js";
import { loadConfig } from "../config.js";
import { layoutFor } from "../paths.js";
import { createPanel } from "./http.js";
import { PAGE } from "./page.js";

const TOKEN = "prompt-test-token";

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

/** A run straight out of init: skeleton prompts, template protocol, both milestones pending. */
function scaffold(run: string): ReturnType<typeof layoutFor> {
  const root = mkdtempSync(join(tmpdir(), "milestoner-prompt-"));
  const scaffolded = capture(() => init({ projectRoot: root, run, count: 2, force: false }));
  assert.equal(scaffolded.code, 0, "the scaffold must succeed");
  return layoutFor(root);
}

function panelFor(layout: ReturnType<typeof layoutFor>, allowWrites: boolean) {
  const config = loadConfig(layout.config, layout.projectRoot);
  return createPanel({ scope: { kind: "project", ctx: { config, layout, cliPath: "" } }, port: 0, token: TOKEN, allowWrites });
}

/** A prompt the linter has nothing against: every skeleton line replaced, the tag named in Exit. */
const filledPrompt = (run: string, id: string) => `# ${id} - Ship the endpoint

## Objective

The prompt endpoints exist and the panel can save a prompt over the skeleton.

## Context

- src/server/api.ts and src/server/http.ts.

## Tasks

1. Implement the endpoints.

## Acceptance criteria

- **AC1** - The round-trip test passes. (evidence: test counts in .milestoner/evidence/${id}-test.txt)

## Exit

- Committed and tagged \`${run}-${id}\`.
`;

const layout = scaffold("prompt-api");
const panel = panelFor(layout, true);
const readOnly = panelFor(layout, false);
const loop = scaffold("prompt-loop");
const loopPanel = panelFor(loop, true);
let base = "";
let readOnlyBase = "";
let loopBase = "";

before(async () => {
  await new Promise<void>((r) => panel.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => readOnly.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => loopPanel.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  readOnlyBase = `http://127.0.0.1:${(readOnly.address() as AddressInfo).port}`;
  loopBase = `http://127.0.0.1:${(loopPanel.address() as AddressInfo).port}`;
});
after(() => {
  panel.close();
  readOnly.close();
  loopPanel.close();
});

interface Reply {
  ok: boolean;
  message: string;
}

const getPrompt = (name: string, at = base) => fetch(`${at}/api/prompt?name=${encodeURIComponent(name)}&token=${TOKEN}`);
const getProtocol = (at = base) => fetch(`${at}/api/protocol?token=${TOKEN}`);

async function postJson(path: string, body: unknown, at = base): Promise<{ status: number; body: Reply }> {
  const res = await fetch(`${at}${path}?token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply };
}

const savePrompt = (name: unknown, content: unknown, at = base) => postJson("/api/prompt", { name, content }, at);
const saveProtocol = (content: unknown, at = base) => postJson("/api/protocol", { content }, at);

const promptOnDisk = (name: string, at = layout) => readFileSync(join(at.prompts, name), "utf8");
const protocolOnDisk = (at = layout) => readFileSync(at.protocol, "utf8");

test("a prompt is served exactly as it is on disk and a save replaces it atomically", async () => {
  const res = await getPrompt("M01.md");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/, "the editor gets the text, not a re-encoding");
  assert.equal(await res.text(), promptOnDisk("M01.md"), "byte for byte, so what is edited is what is there");

  const next = filledPrompt("prompt-api", "M01");
  const { status, body } = await savePrompt("M01.md", next);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /next/, "the reply says a live session keeps the kickoff it started with");

  assert.equal(promptOnDisk("M01.md"), next, "the edit is on disk");
  assert.equal(await (await getPrompt("M01.md")).text(), next, "a re-read serves what was written");

  const leftovers = readdirSync(layout.prompts).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "writeTextAtomic renames a sibling temp file into place and leaves nothing behind");
});

test("the protocol round-trips through its endpoint the same way", async () => {
  const res = await getProtocol();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), protocolOnDisk());

  const next = '# Execution protocol - run "prompt-api"\n\nOne rule: leave evidence.\n';
  const { status, body } = await saveProtocol(next);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /next/);

  assert.equal(protocolOnDisk(), next, "the edit is on disk");
  assert.equal(await (await getProtocol()).text(), next, "a re-read serves what was written");

  const leftovers = readdirSync(layout.dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "no temp file survives the rename");
});

test("a name with path separators or dot-dot is refused, read and write alike", async () => {
  const protocolBefore = protocolOnDisk();
  const promptBefore = promptOnDisk("M01.md");
  for (const name of ["../protocol.md", "..\\M01.md", "prompts/M01.md", "sub\\..\\M01.md", "../../etc/passwd.md"]) {
    assert.equal((await getPrompt(name)).status, 404, `reading ${JSON.stringify(name)} must be refused`);
    const { status, body } = await savePrompt(name, "# overwritten\n");
    assert.equal(status, 409, `writing ${JSON.stringify(name)} must be refused`);
    assert.equal(body.ok, false);
  }
  assert.equal(protocolOnDisk(), protocolBefore, "no traversal spelling reached the protocol");
  assert.equal(promptOnDisk("M01.md"), promptBefore, "and none was rewritten onto a prompt the run owns");
});

test("a name no milestone owns is refused, and so is an empty document", async () => {
  for (const name of ["M99.md", "M01.txt", "M01", "protocol.md", ""]) {
    assert.equal((await getPrompt(name)).status, 404, `reading ${JSON.stringify(name)} must be refused`);
    const { status, body } = await savePrompt(name, "# something\n");
    assert.equal(status, 409, `writing ${JSON.stringify(name)} must be refused`);
    assert.equal(body.ok, false);
    assert.match(body.message, /no milestone in this run|name is required/);
  }
  assert.ok(!existsSync(join(layout.prompts, "M99.md")), "a refused write creates nothing");

  const before = promptOnDisk("M01.md");
  for (const content of ["", "   ", 7, null, undefined]) {
    const { status } = await savePrompt("M01.md", content);
    assert.equal(status, 409, `${JSON.stringify(content)} must be refused`);
  }
  const protocolBefore = protocolOnDisk();
  for (const content of ["", "   ", 7, null, undefined]) {
    const { status } = await saveProtocol(content);
    assert.equal(status, 409, `a protocol of ${JSON.stringify(content)} must be refused`);
  }
  assert.equal(promptOnDisk("M01.md"), before, "the prompt survives every refusal unchanged");
  assert.equal(protocolOnDisk(), protocolBefore, "and so does the protocol");
});

test("both endpoints need the key, the Origin and a write-enabled panel", async () => {
  const promptBefore = promptOnDisk("M01.md");
  const protocolBefore = protocolOnDisk();

  const roPrompt = await savePrompt("M01.md", "# nope\n", readOnlyBase);
  const roProtocol = await saveProtocol("# nope\n", readOnlyBase);
  assert.equal(roPrompt.status, 403, "a read-only panel refuses a prompt write like every other mutation");
  assert.equal(roProtocol.status, 403, "and a protocol write");
  assert.equal((await getPrompt("M01.md", readOnlyBase)).status, 200, "reading a prompt is not a mutation");
  assert.equal((await getProtocol(readOnlyBase)).status, 200, "nor is reading the protocol");

  assert.equal((await fetch(`${base}/api/prompt?name=M01.md`)).status, 401);
  assert.equal((await fetch(`${base}/api/protocol`)).status, 401);
  const anon = await fetch(`${base}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "M01.md", content: "# nope\n" }),
  });
  assert.equal(anon.status, 401);

  for (const path of ["/api/prompt", "/api/protocol"]) {
    const crossOrigin = await fetch(`${base}${path}?token=${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example.com" },
      body: JSON.stringify({ name: "M01.md", content: "# nope\n" }),
    });
    assert.equal(crossOrigin.status, 403, `the Origin check covers ${path} like any other POST`);
  }

  assert.equal(promptOnDisk("M01.md"), promptBefore, "none of them reached the prompt");
  assert.equal(protocolOnDisk(), protocolBefore, "or the protocol");
});

interface Lint {
  errors: number;
  findings: Array<{ milestone: string | null; rule: string; file: string }>;
}

test("saving a filled-in prompt over the skeleton clears that milestone's template-residue findings", async () => {
  const lint = async (): Promise<Lint> => (await (await fetch(`${loopBase}/api/lint?token=${TOKEN}`)).json()) as Lint;
  const onPrompt = (l: Lint, id: string) => l.findings.filter((f) => f.milestone === id && f.file === `.milestoner/prompts/${id}.md`);

  const dirty = await lint();
  assert.ok(onPrompt(dirty, "M01").length > 0, "a fresh scaffold must show findings on the prompt file");
  assert.ok(onPrompt(dirty, "M01").every((f) => f.rule === "template-residue"), "all of them residue: the skeleton is well-formed, just unwritten");

  const { status, body } = await savePrompt("M01.md", filledPrompt("prompt-loop", "M01"), loopBase);
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const after = await lint();
  assert.equal(onPrompt(after, "M01").length, 0, "the save closed the loop: nothing on the prompt file remains");
  assert.ok(onPrompt(after, "M02").length > 0, "the untouched milestone keeps its findings, so the drop was the edit's doing");
  assert.ok(after.errors < dirty.errors, "the run's error count fell with it");
});

test("the page carries a prompt editor per milestone card and a protocol editor", () => {
  for (const id of ["protocolCard", "protocolText", "protocolError", "protocolNote"]) {
    assert.ok(PAGE.includes(`id="${id}"`), `the page must carry ${id}`);
  }
  assert.ok(PAGE.includes("saveProtocol()"), "the protocol editor must be reachable from a button");
  assert.ok(PAGE.includes('api("/api/protocol")'), "and it must talk to the endpoint");
  assert.ok(/protocolNote[\s\S]{0,200}applies to the next one/.test(PAGE), "the note about a live session is on the card");
  assert.ok(/protocolProblem\(a\.message/.test(PAGE), "a protocol refusal is shown inline, not only as a toast");

  for (const fragment of ['id="promptBox-', 'id="promptText-', 'id="promptError-'] as const) {
    assert.ok(PAGE.includes(fragment + "' + esc(m.prompt)"), `each milestone card must carry ${fragment}`);
  }
  assert.ok(PAGE.includes("togglePrompt(this.dataset.name)"), "the editor is collapsed behind a control so the cards stay scannable");
  assert.ok(PAGE.includes("savePrompt(this.dataset.name)"), "with a save inside it");
  assert.ok(PAGE.includes('api("/api/prompt?name="'), "and it must talk to the endpoint");
  assert.ok(PAGE.includes("applies to the next one</span>"), "the applies-to-the-next-session note rides on the editors");
  assert.ok(/promptProblem\(name, a\.message/.test(PAGE), "a prompt refusal is shown inline on its own card");
  assert.ok(/async function savePrompt[\s\S]*?lintRev = null/.test(PAGE), "a saved prompt forces the lint card to refetch");
  assert.ok(/async function saveProtocol[\s\S]*?lintRev = null/.test(PAGE), "and so does a saved protocol");
});
