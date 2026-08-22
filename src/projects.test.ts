import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listProjects, recordProject } from "./projects.js";

function file(): string {
  return join(mkdtempSync(join(tmpdir(), "milestoner-projects-")), "projects.json");
}

test("a project recorded twice is one entry, whatever the path looked like each time", () => {
  const f = file();
  const root = mkdtempSync(join(tmpdir(), "milestoner-known-"));

  assert.equal(recordProject(f, root, "2026-08-22T10:00:00.000Z"), true);
  assert.equal(recordProject(f, root, "2026-08-22T11:00:00.000Z"), true);
  assert.equal(recordProject(f, join(root, "sub", ".."), "2026-08-22T12:00:00.000Z"), true);

  const listed = listProjects(f);
  assert.equal(listed.length, 1, "one directory is one entry, however many commands ran in it");
  assert.equal(listed[0]?.root, root, "the path is stored normalised, not as the command happened to spell it");
  assert.equal(listed[0]?.lastSeen, "2026-08-22T12:00:00.000Z", "the newest visit wins");
});

test("two different projects are both kept, oldest first", () => {
  const f = file();
  const a = mkdtempSync(join(tmpdir(), "milestoner-known-a-"));
  const b = mkdtempSync(join(tmpdir(), "milestoner-known-b-"));
  recordProject(f, a);
  recordProject(f, b);
  recordProject(f, a);

  assert.deepEqual(
    listProjects(f).map((p) => p.root),
    [b, a],
    "re-recording moves a project to the end, so the file reads oldest to newest",
  );
});

test("a corrupt or absent file lists nothing and is written over on the next visit", () => {
  const f = file();
  assert.deepEqual(listProjects(f), [], "nothing written yet");

  writeFileSync(f, "{ half a file");
  assert.deepEqual(listProjects(f), [], "unreadable is empty, not fatal");

  const root = mkdtempSync(join(tmpdir(), "milestoner-known-"));
  assert.equal(recordProject(f, root), true, "a corrupt file must not stop the next command recording");
  assert.deepEqual(
    listProjects(f).map((p) => p.root),
    [root],
  );

  writeFileSync(f, JSON.stringify({ projects: [{ lastSeen: "now" }, 7, null, { root }] }));
  assert.deepEqual(
    listProjects(f).map((p) => p.root),
    [root],
    "entries that are not entries are dropped, the rest survive",
  );
});

/**
 * The real CLI, in a directory of its own. Recording happens in `cli.ts`, so nothing short of
 * running it proves a command records anything. The loader is resolved to an absolute URL because
 * a bare `tsx` would be looked for under the temp directory this runs in.
 */
const TSX = import.meta.resolve("tsx");

function cli(cwd: string, home: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", TSX, join(process.cwd(), "src", "cli.ts"), ...args], {
      cwd,
      stdio: "ignore",
      env: { ...process.env, MILESTONER_HOME: home },
    });
    p.on("error", reject);
    p.on("close", resolve);
  });
}

test("the CLI records the project it worked in, once per directory however often it runs", async () => {
  const home = mkdtempSync(join(tmpdir(), "milestoner-cli-home-"));
  const root = mkdtempSync(join(tmpdir(), "milestoner-cli-"));
  const other = mkdtempSync(join(tmpdir(), "milestoner-cli-other-"));
  const projects = join(home, "projects.json");

  assert.equal(await cli(root, home, ["init", "--run", "recorded", "--milestones", "2"]), 0);
  assert.deepEqual(
    listProjects(projects).map((p) => p.root),
    [root],
    "init records the directory it just scaffolded",
  );

  assert.equal(await cli(root, home, ["status"]), 0, "a project-scoped command in the same directory");
  assert.equal(await cli(root, home, ["status"]), 0);
  assert.equal(listProjects(projects).length, 1, "three commands in one directory is still one entry");

  assert.equal(await cli(other, home, ["init", "--run", "second", "--milestones", "1"]), 0);
  assert.deepEqual(
    listProjects(projects).map((p) => p.root).sort(),
    [root, other].sort(),
    "every project the CLI has worked in is in the file",
  );

  rmSync(join(other, ".milestoner"), { recursive: true, force: true });
  assert.notEqual(await cli(other, home, ["status"]), 0, "no run here any more");
  assert.equal(listProjects(projects).length, 2, "a command that never found a project records nothing new");
  assert.ok(existsSync(projects) && JSON.parse(readFileSync(projects, "utf8")).projects.length === 2);
});
