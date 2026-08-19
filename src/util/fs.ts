import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as T;
}

export function readJsonIfExists<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return readJson<T>(file);
  } catch {
    return null;
  }
}

/** Write via a sibling temp file + rename: a killed runner never leaves a half-written state.json. */
export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const tmp = join(dirname(file), `.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export function writeFileIfMissing(file: string, content: string): boolean {
  if (existsSync(file)) return false;
  ensureDir(dirname(file));
  writeFileSync(file, content, "utf8");
  return true;
}

export function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

export function mtime(path: string): Date | null {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}

export function removeIfExists(file: string): void {
  rmSync(file, { force: true });
}
