import { dirname, resolve } from "node:path";
import { withStateLock } from "./lock.js";
import { samePath } from "./paths.js";
import { readJsonIfExists, writeJsonAtomic } from "./util/fs.js";
import { iso } from "./util/time.js";

export interface ProjectEntry {
  /** The directory holding `.milestoner/`, as the CLI resolved it. */
  root: string;
  /** When a command last ran here. Ordering for the listing, and a date a human can read. */
  lastSeen: string;
}

interface ProjectsFile {
  projects: ProjectEntry[];
}

function isEntry(value: unknown): value is ProjectEntry {
  return typeof (value as Partial<ProjectEntry> | null)?.root === "string";
}

function read(file: string): ProjectEntry[] {
  const raw = readJsonIfExists<ProjectsFile>(file);
  if (!raw || !Array.isArray(raw.projects)) return [];
  return raw.projects.filter(isEntry).map((e) => ({ root: e.root, lastSeen: e.lastSeen ?? "" }));
}

/**
 * Where the CLI has worked, oldest first. Nothing here is checked against the disk: an entry is a
 * path, and whether it still holds a run is the caller's question to ask.
 */
export function listProjects(file: string): ProjectEntry[] {
  return read(file);
}

/**
 * Remember this project, so the machine panel can list it when no runner is alive to say it exists.
 * Deduplicated by path, most recent last, and serialised with the same lock as the registry.
 *
 * Best-effort for the same reason registry writes are (D-025): recording where work happened is a
 * convenience across projects, and must never become a precondition for the command doing the work.
 * Nothing is ever removed - a path that is unreachable today is a network share or an external disk
 * tomorrow, and the hub already skips what it cannot read.
 */
export function recordProject(file: string, root: string, now: string = iso()): boolean {
  try {
    withStateLock(dirname(file), () => {
      const kept = read(file).filter((p) => !samePath(p.root, root));
      writeJsonAtomic(file, { projects: [...kept, { root: resolve(root), lastSeen: now }] } satisfies ProjectsFile);
    });
    return true;
  } catch {
    return false;
  }
}
