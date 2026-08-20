import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MILESTONER_DIR, LEGACY_DIRS, findLegacyRoot, findProjectRoot, layoutFor } from "./paths.js";

function project(dir: string): string {
  const root = mkdtempSync(join(tmpdir(), "milestoner-"));
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "config.json"), "{}");
  return root;
}

test("the project root is found from a nested directory", () => {
  const root = project(MILESTONER_DIR);
  const nested = join(root, "src", "deep");
  mkdirSync(nested, { recursive: true });

  assert.equal(findProjectRoot(nested), root);
  assert.equal(findLegacyRoot(nested), null);
});

test("a run under any older directory name is found separately, so the CLI can explain the migration", () => {
  for (const dir of LEGACY_DIRS) {
    const root = project(dir);

    assert.equal(findProjectRoot(root), null, `${dir} must not be treated as a working project`);
    assert.deepEqual(findLegacyRoot(root), { root, dir });
  }
});

test("every rename keeps the previous names findable, not just the last one", () => {
  assert.ok(LEGACY_DIRS.includes(".dogwatch"), "a run parked across three renames still needs the message");
  assert.ok(LEGACY_DIRS.includes(".pulseflow"));
  assert.ok(LEGACY_DIRS.includes(".runpulse"));
  assert.ok(!(LEGACY_DIRS as readonly string[]).includes(MILESTONER_DIR), "the current name is not a legacy one");
});

test("the whole layout hangs off the directory name, which is why renaming it is the migration", () => {
  const layout = layoutFor("/p");
  for (const path of Object.values(layout)) {
    if (path === "/p") continue;
    assert.ok(String(path).includes(MILESTONER_DIR), `${path} escapes the milestoner directory`);
  }
});
