import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyInfraFailure, hasUnescapablePercent, quoteCmdArg } from "./session.js";
import { defaultConfig } from "./config.js";

const infra = defaultConfig("t", ".").infra;

test("an instant death with a tiny transcript is infrastructure", () => {
  const v = classifyInfraFailure({ seconds: 12, bytes: 180, text: "connection reset", wroteResult: false }, infra);
  assert.equal(v?.reason, "instant-death");
  assert.equal(v?.waitSeconds, infra.genericWaitSeconds);
});

test("a usage limit is infrastructure even with a larger transcript", () => {
  const v = classifyInfraFailure(
    { seconds: 40, bytes: 2000, text: "You've hit your usage limit. Try again later.", wroteResult: false },
    infra,
  );
  assert.equal(v?.reason, "usage-limit");
  assert.equal(v?.waitSeconds, infra.usageLimitWaitSeconds);
});

test("an announced reset time replaces the fixed usage-limit wait", () => {
  const now = new Date("2026-08-18T14:00:00");
  const v = classifyInfraFailure(
    { seconds: 5, bytes: 90, text: "session limit reached - resets 3:00pm", wroteResult: false },
    infra,
    now,
  );
  assert.equal(v?.reason, "usage-limit");
  assert.equal(v?.waitSeconds, 3600 + 30);
});

test("a session that wrote a result is never infrastructure", () => {
  const v = classifyInfraFailure({ seconds: 3, bytes: 10, text: "usage limit", wroteResult: true }, infra);
  assert.equal(v, null);
});

test("a long session with a small transcript is real work, not infrastructure", () => {
  const v = classifyInfraFailure({ seconds: 4000, bytes: 120, text: "", wroteResult: false }, infra);
  assert.equal(v, null);
});

test("an agent that crashed after fifteen minutes of work does not cost the milestone an attempt", () => {
  // The real shape from M03 of the v0.5 run: the session finished the work, then exited 0 after
  // 929 seconds leaving a fifteen-byte transcript and no result.json. The exit code is absent from
  // the input on purpose - the verdict never comes from it.
  const v = classifyInfraFailure({ seconds: 929, bytes: 15, text: "Execution error", wroteResult: false }, infra);
  assert.equal(v?.reason, "crash");
  assert.equal(v?.waitSeconds, infra.genericWaitSeconds);
  assert.match(v?.detail ?? "", /929s/);
  assert.match(v?.detail ?? "", /15-byte/);
});

test("one byte under the crash line is a crash, however long the session ran", () => {
  const v = classifyInfraFailure({ seconds: 4000, bytes: infra.crashTranscriptBytes - 1, text: "", wroteResult: false }, infra);
  assert.equal(v?.reason, "crash");
});

test("at the crash line the transcript counts as work and the attempt is charged", () => {
  const v = classifyInfraFailure({ seconds: 4000, bytes: infra.crashTranscriptBytes, text: "", wroteResult: false }, infra);
  assert.equal(v, null, "a transcript with something in it is graded, not refunded");
});

test("an agent that never reached its model is infrastructure, however loudly it said so", () => {
  // The real shape from a codex session pointed at a model server that was not listening: 40s of
  // reconnect chatter, 2 KB of transcript. Too long-lived and too talkative for the tiny-transcript
  // rule, and not a usage limit - so before this pattern list it cost an attempt.
  const v = classifyInfraFailure(
    {
      seconds: 40,
      bytes: 2098,
      text: "ERROR: Reconnecting... 5/5\nERROR: stream disconnected before completion: error sending request",
      wroteResult: false,
    },
    infra,
  );
  assert.equal(v?.reason, "agent-failure");
  assert.equal(v?.waitSeconds, infra.genericWaitSeconds, "there is no announced reset to wait out");
  assert.match(v?.detail ?? "", /stream disconnected/);
});

test("a usage limit still wins over a generic agent failure", () => {
  const v = classifyInfraFailure(
    { seconds: 5, bytes: 900, text: "stream disconnected\nYou've hit your usage limit - resets 3:00pm", wroteResult: false },
    infra,
    new Date("2026-08-18T14:00:00"),
  );
  assert.equal(v?.reason, "usage-limit", "the announced reset is the more useful of the two");
});

test("a session that did real work is never refunded, whatever its text says", () => {
  const v = classifyInfraFailure(
    { seconds: 4000, bytes: 90000, text: "connection refused (in a test we then fixed)", wroteResult: false },
    infra,
  );
  assert.equal(v, null);
});

test("cmd-shim quoting keeps operators and quotes inside one argument", () => {
  assert.equal(quoteCmdArg('a "b" & c | d'), '"a ""b"" & c | d"');
  assert.equal(quoteCmdArg("plain"), '"plain"');
});

test("%VAR% is flagged because cmd expands it and it cannot be escaped", () => {
  assert.equal(hasUnescapablePercent(["read %PATH% please"]), true);
  assert.equal(hasUnescapablePercent(["100% done"]), false);
});
