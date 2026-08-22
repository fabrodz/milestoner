import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { layoutFor } from "../paths.js";
import { init, protocolRunName, type InitResult } from "./init.js";

// Colour depends on whether stdout is a tty, which is not the same when the file is run on its own.
const plain = (s: string) => s.replaceAll(/\x1b\[\d+m/g, "");

function capture(fn: () => InitResult): InitResult & { out: string } {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { ...fn(), out: plain(lines.join("\n")) };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function scaffold(run: string): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-init-"));
  const first = capture(() => init({ projectRoot: root, run, count: 2, force: false }));
  assert.equal(first.code, 0, "the first scaffold must succeed");
  return root;
}

test("a fresh scaffold writes a protocol naming the run, tagged without a slash", () => {
  const root = scaffold("checkout-v2");
  const layout = layoutFor(root);

  const protocol = readFileSync(layout.protocol, "utf8");
  assert.equal(protocolRunName(protocol), "checkout-v2");
  assert.match(protocol, /tag `checkout-v2-<milestoneId>`/);
  assert.ok(
    !protocol.includes("tag `checkout-v2/"),
    "a tag named like a branch makes `git push origin <name>` ambiguous the day both exist",
  );
  assert.match(readFileSync(join(layout.prompts, "M01.md"), "utf8"), /tagged `checkout-v2-M01`/);
});

test("scaffolding over a protocol naming a different run refuses before writing anything", () => {
  const root = scaffold("v04-plugin");
  const layout = layoutFor(root);
  const before = readFileSync(layout.protocol, "utf8");

  const { code, out } = capture(() => init({ projectRoot: root, run: "v05-debt", count: 3, force: true }));

  assert.equal(code, 1);
  assert.match(out, /names run "v04-plugin", not "v05-debt"/);
  assert.match(out, /Nothing was scaffolded/);
  assert.equal(readFileSync(layout.protocol, "utf8"), before, "the protocol is hand-edited and must survive untouched");
  assert.equal(JSON.parse(readFileSync(layout.state, "utf8")).run, "v04-plugin", "no state for the new run may exist");
  assert.equal(JSON.parse(readFileSync(layout.config, "utf8")).run, "v04-plugin", "the config must not have been overwritten");
});

test("re-init over the same run's protocol keeps it byte for byte and says nothing about it", () => {
  const root = scaffold("checkout-v2");
  const layout = layoutFor(root);
  const edited = readFileSync(layout.protocol, "utf8") + "\n## 7. House rule\n\nNever touch src/legacy/.\n";
  writeFileSync(layout.protocol, edited);

  const { code, out } = capture(() => init({ projectRoot: root, run: "checkout-v2", count: 2, force: true }));

  assert.equal(code, 0);
  assert.equal(readFileSync(layout.protocol, "utf8"), edited, "hand edits must survive a re-init");
  assert.ok(
    !out.includes("names run") && !out.includes("does not name a run"),
    "a protocol that matches the run is not worth a warning",
  );
});

test("every outcome comes back as a message and a tag, for a caller that cannot read the console", () => {
  const root = scaffold("checkout-v2");

  const again = capture(() => init({ projectRoot: root, run: "checkout-v2", count: 2, force: false }));
  assert.equal(again.code, 1);
  assert.equal(again.refusal, "config-exists");
  assert.match(again.message, /already exists - use --force/);

  const foreign = capture(() => init({ projectRoot: root, run: "other-run", count: 2, force: true }));
  assert.equal(foreign.code, 1);
  assert.equal(foreign.refusal, "foreign-protocol", "force does not answer this one, so nothing may offer it");
  assert.match(foreign.message, /names run "checkout-v2", not "other-run"/);

  const fresh = capture(() => init({ projectRoot: mkdtempSync(join(tmpdir(), "milestoner-init-")), run: "fresh", count: 1, force: false }));
  assert.equal(fresh.code, 0);
  assert.equal(fresh.refusal, undefined);
  assert.match(fresh.message, /initialized \.milestoner\/ for run "fresh"/);
});

test("a protocol that does not name a run is kept, with a warning that it cannot be checked", () => {
  const root = scaffold("checkout-v2");
  const layout = layoutFor(root);
  writeFileSync(layout.protocol, "# Our rules\n\nDo the work.\n");

  const { code, out } = capture(() => init({ projectRoot: root, run: "rewrite", count: 2, force: true }));

  assert.equal(code, 0);
  assert.match(out, /does not name a run/);
  assert.equal(readFileSync(layout.protocol, "utf8"), "# Our rules\n\nDo the work.\n");
});
