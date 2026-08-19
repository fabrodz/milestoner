import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Schema-level checks for the two plugin manifests that need no external CLI, so this
// is the authoritative manifest gate on every CI runner (the Claude CLI is not installed
// on GitHub-hosted runners; ci.yml runs the strict validator only when it happens to be
// present). Fails the build on a manifest that does not parse, is missing a required
// field, or whose version disagrees with package.json.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function load(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (err) {
    errors.push(`${rel}: ${err.message}`);
    return null;
  }
}

function require(rel, obj, path) {
  let value = obj;
  for (const key of path.split(".")) {
    value = value?.[key];
  }
  if (value === undefined || value === null || value === "") {
    errors.push(`${rel}: missing required field ${path}`);
  }
  return value;
}

const pkg = load("package.json");
const plugin = load(".claude-plugin/plugin.json");
const marketplace = load(".claude-plugin/marketplace.json");

if (plugin) {
  for (const field of ["name", "version", "description"]) require(".claude-plugin/plugin.json", plugin, field);
}
if (marketplace) {
  require(".claude-plugin/marketplace.json", marketplace, "name");
  require(".claude-plugin/marketplace.json", marketplace, "owner.name");
  const entry = marketplace.plugins?.[0];
  if (!entry) {
    errors.push(".claude-plugin/marketplace.json: plugins[0] is missing");
  } else {
    for (const field of ["name", "version", "source"]) require(".claude-plugin/marketplace.json plugins[0]", entry, field);
  }
}

if (pkg && plugin && marketplace?.plugins?.[0]) {
  const source = pkg.version;
  if (plugin.version !== source) errors.push(`version drift: plugin.json ${plugin.version} != package.json ${source}`);
  if (marketplace.plugins[0].version !== source)
    errors.push(`version drift: marketplace entry ${marketplace.plugins[0].version} != package.json ${source}`);
}

if (errors.length) {
  console.error("manifest check failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`manifest check passed: plugin and marketplace agree on version ${pkg.version}`);
