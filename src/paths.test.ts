import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LEGACY_DIR, PULSEFLOW_DIR, findLegacyRoot, findProjectRoot, layoutFor } from "./paths.js";

function project(dir: string): string {
  const root = mkdtempSync(join(tmpdir(), "pulseflow-"));
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "config.json"), "{}");
  return root;
}

test("the project root is found from a nested directory", () => {
  const root = project(PULSEFLOW_DIR);
  const nested = join(root, "src", "deep");
  mkdirSync(nested, { recursive: true });

  assert.equal(findProjectRoot(nested), root);
  assert.equal(findLegacyRoot(nested), null);
});

test("a pre-rename .runpulse run is found separately, so the CLI can explain the migration", () => {
  const root = project(LEGACY_DIR);

  assert.equal(findProjectRoot(root), null, "it must not be treated as a working project");
  assert.equal(findLegacyRoot(root), root);
});

test("the whole layout hangs off the directory name, which is why renaming it is the migration", () => {
  const layout = layoutFor("/p");
  for (const path of Object.values(layout)) {
    if (path === "/p") continue;
    assert.ok(String(path).includes(PULSEFLOW_DIR), `${path} escapes the pulseflow directory`);
  }
});
