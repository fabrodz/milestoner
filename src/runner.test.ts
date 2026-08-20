import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "./config.js";
import { layoutFor } from "./paths.js";
import { buildKickoff } from "./runner.js";
import { parseSteering } from "./steering.js";
import type { Milestone } from "./types.js";

const config = defaultConfig("my-run", "/project");
const layout = layoutFor("/project");
const milestone: Milestone = {
  id: "M01",
  title: "Domain model",
  prompt: "M01.md",
  status: "pending",
  attempts: 0,
  evidence: [],
  history: [],
};

test("the kickoff points at the protocol, the prompt and the result contract", () => {
  const kickoff = buildKickoff(config, layout, milestone, null);
  assert.match(kickoff, /\.milestoner\/protocol\.md/);
  assert.match(kickoff, /\.milestoner\/prompts\/M01\.md/);
  assert.match(kickoff, /\.milestoner\/result\.json/);
  assert.match(kickoff, /Do not edit state\.json/);
  assert.ok(!kickoff.includes("STEERING"), "no steering section when there is none");
});

test("steering is inlined into the kickoff, not merely referenced", () => {
  const steering = parseSteering("- stop gold-plating the CLI output");
  const kickoff = buildKickoff(config, layout, milestone, steering);

  assert.ok(kickoff.includes("stop gold-plating the CLI output"), "the session must see the text itself");
  assert.match(kickoff, /overrides the milestone prompt/);
  assert.match(kickoff, /does not license\ndropping an acceptance criterion/);
});
