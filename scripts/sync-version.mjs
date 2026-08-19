import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// package.json is the single source of the version. The two plugin manifests carry a
// copy so the marketplace and the plugin runtime can read it without npm; this derives
// them from the source. A drift-guard test (src/version.test.ts) fails if they disagree.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

for (const rel of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  const file = join(root, rel);
  const before = readFileSync(file, "utf8");
  // Line-level replace, not JSON.stringify, so the hand-formatting of these files survives.
  const after = before.replace(/("version":\s*)"[^"]*"/g, `$1"${version}"`);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`synced ${rel} -> ${version}`);
  }
}
