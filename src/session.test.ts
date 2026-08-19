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

test("cmd-shim quoting keeps operators and quotes inside one argument", () => {
  assert.equal(quoteCmdArg('a "b" & c | d'), '"a ""b"" & c | d"');
  assert.equal(quoteCmdArg("plain"), '"plain"');
});

test("%VAR% is flagged because cmd expands it and it cannot be escaped", () => {
  assert.equal(hasUnescapablePercent(["read %PATH% please"]), true);
  assert.equal(hasUnescapablePercent(["100% done"]), false);
});
