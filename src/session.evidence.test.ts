import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readTranscriptEvidence } from "./session.js";

const write = (lines: string[]): string => {
  const file = join(mkdtempSync(join(tmpdir(), "milestoner-evidence-")), "session.log");
  writeFileSync(file, lines.join("\n"));
  return file;
};

const init = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", tools: "x".repeat(3800), model: "claude-opus-5", ...extra });
const assistant = (text: string) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
// `type` is the last key on a real result event, which is why nothing here may read the prefix.
const result = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ is_error: false, num_turns: 1, session_id: "0dddbe1d", result: "done", type: "result", ...over });
const rateLimit = (info: Record<string, unknown>) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });

test("a plain-text transcript is all evidence, exactly as it was before stream-json existed", () => {
  const file = write(["Execution error"]);
  assert.equal(readTranscriptEvidence(file).bytes, 15);
});

test("the init inventory and the result envelope are not evidence", () => {
  const file = write([rateLimit({ status: "allowed" }), init(), result({ is_error: true }), ""]);
  const evidence = readTranscriptEvidence(file);
  assert.equal(evidence.bytes, 0, "a session that produced nothing weighs nothing, whatever the file weighs");
  assert.ok(evidence.text.length < 200, "the four-kilobyte inventory is not searched for infra patterns");
});

test("what the agent said is evidence, and the closing envelope stays searchable", () => {
  const file = write([init(), assistant("I could not reach the model"), result({ is_error: true, result: "stream disconnected" }), ""]);
  const evidence = readTranscriptEvidence(file);
  assert.equal(evidence.bytes, Buffer.byteLength(assistant("I could not reach the model")) + 1);
  assert.match(evidence.text, /stream disconnected/, "a failure names itself in the envelope");
  assert.doesNotMatch(evidence.text, /claude-opus-5/, "but the preamble is gone");
});

test("a non-allowed rate limit is reported with its reset time", () => {
  const file = write([rateLimit({ status: "rejected", resetsAt: 1788045600 }), init(), result({ is_error: true }), ""]);
  assert.deepEqual(readTranscriptEvidence(file).usageLimit, { resetsAt: 1788045600 });
});

test("an allowed rate limit is the every-session case and reports nothing", () => {
  const file = write([rateLimit({ status: "allowed", resetsAt: 1788045600 }), init(), assistant("done"), result(), ""]);
  assert.equal(readTranscriptEvidence(file).usageLimit, null);
});

test("a quota that ran out long past the byte cap is still found", () => {
  const bulk = Array.from({ length: 400 }, (_, i) => assistant("x".repeat(400) + i));
  const file = write([init(), ...bulk, rateLimit({ status: "rejected", resetsAt: 1788045600 }), ""]);
  const evidence = readTranscriptEvidence(file);
  assert.deepEqual(evidence.usageLimit, { resetsAt: 1788045600 }, "counting stops at the cap; looking for this does not");
  assert.ok(evidence.bytes >= 64_000, "and the work counted is plainly past anything a threshold asks about");
});

test("a transcript that is not there is not evidence of anything", () => {
  assert.deepEqual(readTranscriptEvidence(join(tmpdir(), "milestoner-nope", "gone.log")), { bytes: 0, text: "", usageLimit: null });
});
