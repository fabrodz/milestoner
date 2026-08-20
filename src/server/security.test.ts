import assert from "node:assert/strict";
import { test } from "node:test";
import { hostAllowed, newToken, originAllowed, tokenMatches } from "./security.js";

test("a token only matches itself", () => {
  const t = newToken();
  assert.ok(tokenMatches(t, t));
  assert.ok(!tokenMatches(t, undefined));
  assert.ok(!tokenMatches(t, ""));
  assert.ok(!tokenMatches(t, t + "x"), "a longer string must not match");
  assert.ok(!tokenMatches(t, t.slice(0, -1)), "nor a prefix of it");
});

test("tokens are long enough and distinct", () => {
  const a = newToken();
  assert.ok(a.length >= 32, `too short: ${a.length}`);
  assert.notEqual(a, newToken());
  assert.match(a, /^[A-Za-z0-9_-]+$/, "must survive a URL without escaping");
});

test("only a loopback Host is served, which is what stops DNS rebinding", () => {
  assert.ok(hostAllowed("127.0.0.1:4400"));
  assert.ok(hostAllowed("localhost:4400"));
  assert.ok(hostAllowed("localhost"));
  assert.ok(hostAllowed("127.0.0.1:54321"), "an ephemeral port is still us");
  // Resolves to 127.0.0.1 but arrives with the attacker's name in the address bar.
  assert.ok(!hostAllowed("evil.example.com:4400"));
  assert.ok(!hostAllowed("127.0.0.1.evil.com:4400"));
  assert.ok(!hostAllowed("evil.com"));
  assert.ok(!hostAllowed(undefined));
});

test("a cross-origin post is refused, and a non-browser client is not", () => {
  assert.ok(originAllowed("http://127.0.0.1:4400", 4400));
  assert.ok(originAllowed("http://localhost:4400", 4400));
  assert.ok(!originAllowed("http://127.0.0.1", 4400), "a bare origin is not this server");
  assert.ok(originAllowed(undefined, 4400), "curl and the CLI send no Origin");
  assert.ok(!originAllowed("http://evil.example.com", 4400));
  assert.ok(!originAllowed("null", 4400), "a sandboxed iframe posts Origin: null");
  assert.ok(!originAllowed("http://127.0.0.1:9999", 4400), "another local server is still not us");
});
