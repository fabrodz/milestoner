import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTranscript } from "./transcript.js";

test("a stream-json session is rendered as the session, not as its wire format", () => {
  const out = renderTranscript([
    JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", model: "claude-opus-5", tools: ["Bash", "Read"] }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Reading the runner." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/runner.ts" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "export function run() {}" }] } }),
    JSON.stringify({ is_error: false, num_turns: 4, duration_ms: 92_000, type: "result" }),
  ].join("\n"));

  assert.match(out, /- session started on claude-opus-5 in \/repo/);
  assert.match(out, /Reading the runner\./);
  assert.match(out, /> Read .*src\/runner\.ts/);
  assert.match(out, /< export function run/);
  assert.match(out, /- session ended after 92s, 4 turns/);
  assert.doesNotMatch(out, /"type":/, "no line survives as raw JSON");
});

test("an errored result says so", () => {
  assert.match(renderTranscript(JSON.stringify({ is_error: true, type: "result", duration_ms: 3000 })), /- session ended with an error after 3s/);
});

test("the telemetry a real session emits between turns is not rendered as anything", () => {
  const out = renderTranscript([
    JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", model: "claude-opus-5" }),
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50 }),
    JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 120 }),
    JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1788045600 } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
  ].join("\n"));

  assert.equal(out.match(/- session started/g)?.length, 1, "one session, said once");
  assert.doesNotMatch(out, /thinking_tokens|estimated_tokens|resetsAt/);
  assert.match(out, /done/);
});

test("a half-written last line does not lose the session that came before it", () => {
  const out = renderTranscript(
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "still going" }] } })}\n{"type":"assis`,
  );
  assert.match(out, /still going/, "the completed events still render");
  assert.match(out, /\{"type":"assis/, "and the partial line is shown rather than swallowed");
});

test("a huge tool result is cut down rather than printed whole", () => {
  const out = renderTranscript(
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(50_000) }] } }),
  );
  assert.ok(out.length < 400, `a supervisor reads this every cycle, got ${out.length} chars`);
  assert.match(out, /…$/, "and it says it was cut");
});

// The engine never learns agent names, and neither does this. Three shapes that are not Claude
// Code's have to come back readable, because the panel and `milestoner transcript` are the same
// view for every agent the config can name.

test("a plain-text transcript is passed through exactly as it was written", () => {
  const raw = "Reading src/runner.ts\nPatching the loop\nAll tests pass\n";
  assert.equal(renderTranscript(raw), raw);
  assert.equal(renderTranscript(""), "");
});

test("NDJSON of another shape is passed through rather than guessed at", () => {
  // `codex exec --json` puts its type under `msg`, so no line here is an event this knows.
  const raw = [
    '{"id":"0","msg":{"type":"task_started"}}',
    '{"id":"0","msg":{"type":"agent_message","message":"Patched the loop"}}',
  ].join("\n");
  assert.equal(renderTranscript(raw), raw);
});

test("an agent that streams prose with the odd JSON line keeps both", () => {
  const raw = 'thinking about the loop\n{"id":1,"note":"no top-level type"}\ndone';
  assert.equal(renderTranscript(raw), raw);
});
