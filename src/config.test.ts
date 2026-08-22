import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentArgs, defaultConfig, loadConfig, renderTemplate, resolveModel } from "./config.js";

test("placeholders are substituted, unknown ones stay visible", () => {
  assert.equal(renderTemplate("run {{id}} in {{root}}", { id: "M01", root: "/p" }), "run M01 in /p");
  assert.equal(renderTemplate("{{nope}}", {}), "{{nope}}");
});

test("model args are appended only when a model is configured", () => {
  const config = defaultConfig("t", "/p");
  const vars = { kickoff: "do M01", promptFile: "/p/.milestoner/prompts/M01.md", milestoneId: "M01", projectRoot: "/p", model: "" };
  assert.deepEqual(buildAgentArgs(config.agent, vars), ["-p", "do M01", "--dangerously-skip-permissions"]);

  config.agent.model = "claude-opus-5";
  assert.deepEqual(buildAgentArgs(config.agent, vars), ["-p", "do M01", "--dangerously-skip-permissions", "--model", "claude-opus-5"]);
});

test("a different agent is only a config change", () => {
  const config = defaultConfig("t", "/p");
  config.agent = { command: "codex", args: ["exec", "--file", "{{promptFile}}"], modelArgs: [], model: null, env: {} };
  const args = buildAgentArgs(config.agent, { promptFile: "/p/M01.md", kickoff: "x", milestoneId: "M01", projectRoot: "/p", model: "" });
  assert.deepEqual(args, ["exec", "--file", "/p/M01.md"]);
});

test("a partial config keeps the defaults it does not mention", () => {
  const file = join(mkdtempSync(join(tmpdir(), "milestoner-")), "config.json");
  writeFileSync(file, JSON.stringify({ run: "partial", agent: { command: "codex" }, infra: { deathSeconds: 30 } }));
  const config = loadConfig(file, "/p");

  assert.equal(config.agent.command, "codex");
  assert.deepEqual(config.agent.args, defaultConfig("t", "/p").agent.args);
  assert.equal(config.infra.deathSeconds, 30);
  assert.equal(config.infra.maxRetries, 30);
  assert.equal(config.infra.crashTranscriptBytes, 100);
  assert.equal(config.environment.attendCommand, null);
  assert.equal(config.environment.attendSeconds, 120);
  assert.equal(config.projectRoot, "/p");
});

test("the per-milestone model map survives a partial config, and defaults to empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "milestoner-"));
  const withMap = join(dir, "with-map.json");
  writeFileSync(withMap, JSON.stringify({ run: "mapped", agent: { command: "claude" }, infra: {}, models: { M02: "opus", M03: "haiku" } }));
  assert.deepEqual(loadConfig(withMap, "/p").models, { M02: "opus", M03: "haiku" });

  const without = join(dir, "without-map.json");
  writeFileSync(without, JSON.stringify({ run: "unmapped", agent: { command: "claude" }, infra: {} }));
  assert.deepEqual(loadConfig(without, "/p").models, {});
  assert.deepEqual(defaultConfig("t", "/p").models, {});
});

test("resolveModel: the run override beats the map, which beats the agent's own model", () => {
  const config = defaultConfig("t", "/p");
  config.agent.model = "sonnet";
  config.models = { M02: "opus" };

  assert.equal(resolveModel(config, "M02"), "opus");
  assert.equal(resolveModel(config, "M01"), "sonnet");
  assert.equal(resolveModel(config, "M02", "haiku"), "haiku");
  assert.equal(resolveModel(config, "M01", "haiku"), "haiku");

  config.agent.model = null;
  assert.equal(resolveModel(config, "M01"), null);
});

test("buildAgentArgs takes an explicit model over the agent's own", () => {
  const config = defaultConfig("t", "/p");
  config.agent.model = "sonnet";
  const vars = { kickoff: "do M02", promptFile: "/p/M02.md", milestoneId: "M02", projectRoot: "/p", model: "opus" };

  assert.deepEqual(buildAgentArgs(config.agent, vars, "opus").slice(-2), ["--model", "opus"]);
  assert.deepEqual(buildAgentArgs(config.agent, vars).slice(-2), ["--model", "sonnet"]);
  assert.deepEqual(buildAgentArgs(config.agent, { ...vars, model: "" }, null), ["-p", "do M02", "--dangerously-skip-permissions"]);
});

test("a config without the required fields is rejected", () => {
  const file = join(mkdtempSync(join(tmpdir(), "milestoner-")), "config.json");
  writeFileSync(file, JSON.stringify({ run: "no-agent" }));
  assert.throws(() => loadConfig(file, "/p"), /missing required field "agent"/);
});
