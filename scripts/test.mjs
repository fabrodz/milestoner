import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Node 20 cannot glob in `--test`, and no shell expands the pattern on Windows.
function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const files = testFiles("src").sort();
if (files.length === 0) {
  console.error("no test files found under src/");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("close", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
