import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

// package.json is the source; the two plugin manifests carry a derived copy (scripts/sync-version.mjs).
// This is the gate that makes the three a single source: it fails the moment they disagree.
test("the version is single-sourced across package.json, plugin.json and the marketplace entry", () => {
  const source = readJson("package.json").version as string;
  const plugin = readJson(".claude-plugin/plugin.json").version as string;
  const marketplace = readJson(".claude-plugin/marketplace.json").plugins[0].version as string;

  assert.equal(plugin, source, `.claude-plugin/plugin.json version ${plugin} disagrees with package.json ${source}`);
  assert.equal(marketplace, source, `marketplace entry version ${marketplace} disagrees with package.json ${source}`);
});
