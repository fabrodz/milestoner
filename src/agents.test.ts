import assert from "node:assert/strict";
import { test } from "node:test";
import { benchAndRotate, createPool, currentAgent, hasFallbacks } from "./agents.js";
import { defaultConfig } from "./config.js";
import type { AgentConfig, MilestonerConfig } from "./types.js";

function poolOf(...names: string[]): MilestonerConfig {
  const config = defaultConfig("t", "/p");
  const make = (name: string): AgentConfig => ({ ...config.agent, name, command: name });
  config.agent = make(names[0]!);
  config.fallbackAgents = names.slice(1).map(make);
  return config;
}

const NOW = Date.parse("2026-08-19T02:00:00.000Z");

test("a run with no fallbacks behaves exactly as it did before rotation existed", () => {
  const pool = createPool(defaultConfig("t", "/p"));
  assert.equal(hasFallbacks(pool), false);
  assert.equal(currentAgent(pool).name, "claude", "the name defaults to the command");

  const r = benchAndRotate(pool, 600, NOW);
  assert.equal(r.switched, false, "there is nobody to switch to");
  assert.equal(r.next.name, "claude");
  assert.equal(r.waitSeconds, 600, "so it waits the failure out, as before");
});

test("an agent that is out of quota hands the run to one that is free, without waiting", () => {
  const pool = createPool(poolOf("claude", "codex"));

  const r = benchAndRotate(pool, 3 * 3600, NOW); // "resets at 5am"
  assert.equal(r.switched, true);
  assert.equal(r.next.name, "codex");
  assert.equal(r.waitSeconds, 0, "waiting three hours with a free agent available is the bug this fixes");
  assert.equal(currentAgent(pool).name, "codex");
});

test("when everyone is benched it sleeps for the shortest cooldown and resumes there", () => {
  const pool = createPool(poolOf("claude", "codex"));

  benchAndRotate(pool, 3 * 3600, NOW); // claude until 05:00, now on codex
  const r = benchAndRotate(pool, 120, NOW); // codex until 02:02

  assert.equal(r.waitSeconds, 120, "the shortest cooldown, not the longest");
  assert.equal(r.next.name, "codex");
});

test("the primary comes back when its quota does, instead of being written off for the run", () => {
  const pool = createPool(poolOf("claude", "codex"));
  benchAndRotate(pool, 3600, NOW);
  assert.equal(currentAgent(pool).name, "codex");

  // An hour later codex trips over something and claude is free again.
  const later = NOW + 3600 * 1000 + 1000;
  const r = benchAndRotate(pool, 60, later);

  assert.equal(r.next.name, "claude", "sticky rotation would have finished the run on the fallback");
  assert.equal(r.waitSeconds, 0);
});

test("with three agents it does not retry the same fallback first every time", () => {
  const pool = createPool(poolOf("a", "b", "c"));

  assert.equal(benchAndRotate(pool, 600, NOW).next.name, "b");
  assert.equal(benchAndRotate(pool, 600, NOW).next.name, "c");
});

test("benching never shortens a cooldown already in force", () => {
  const pool = createPool(poolOf("a", "b"));
  benchAndRotate(pool, 3600, NOW); // a until 03:00, now on b
  benchAndRotate(pool, 10, NOW); //   b until 02:00:10, both benched

  // Back on a with a short failure: its long reset must survive.
  pool.index = 0;
  const r = benchAndRotate(pool, 5, NOW);
  assert.equal(r.next.name, "b", "b frees up first");
  assert.equal(pool.slots[0]!.availableAt, NOW + 3600 * 1000, "a still waits for its announced reset");
});
