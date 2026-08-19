import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentArgs, defaultConfig, renderTemplate } from "./config.js";

test("placeholders are substituted, unknown ones stay visible", () => {
  assert.equal(renderTemplate("run {{id}} in {{root}}", { id: "M01", root: "/p" }), "run M01 in /p");
  assert.equal(renderTemplate("{{nope}}", {}), "{{nope}}");
});

test("model args are appended only when a model is configured", () => {
  const config = defaultConfig("t", "/p");
  const vars = { kickoff: "do M01", promptFile: "/p/.runpulse/prompts/M01.md", milestoneId: "M01", projectRoot: "/p", model: "" };
  assert.deepEqual(buildAgentArgs(config, vars), ["-p", "do M01", "--dangerously-skip-permissions"]);

  config.agent.model = "claude-opus-5";
  assert.deepEqual(buildAgentArgs(config, vars), ["-p", "do M01", "--dangerously-skip-permissions", "--model", "claude-opus-5"]);
});

test("a different agent is only a config change", () => {
  const config = defaultConfig("t", "/p");
  config.agent = { command: "codex", args: ["exec", "--file", "{{promptFile}}"], modelArgs: [], model: null, env: {} };
  const args = buildAgentArgs(config, { promptFile: "/p/M01.md", kickoff: "x", milestoneId: "M01", projectRoot: "/p", model: "" });
  assert.deepEqual(args, ["exec", "--file", "/p/M01.md"]);
});
