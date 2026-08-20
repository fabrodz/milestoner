import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Loopback only. Not a default to be overridden: see the note on `serve` in the guide. */
export const BIND_HOST = "127.0.0.1";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  // Length differs: comparing would throw, and the answer is no either way.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenFrom(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token") ?? undefined;
}

/**
 * A browser will happily resolve an attacker-controlled name to 127.0.0.1 and then talk to this
 * server with the attacker's page in the address bar. Binding to loopback does not stop that; only
 * refusing a Host header we did not expect does.
 */
export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  // Only the name is checked. The port carries no security here - anyone who can set the Host
  // header sets the port too - and pinning it to a configured value breaks the moment the server
  // listens on an ephemeral one.
  const name = host.replace(/:\d+$/, "");
  return ALLOWED_HOSTS.has(name);
}

/**
 * Anything that changes the run must come from our own page. Without this, a page the user happens
 * to have open can post to this server with a token it guessed its way into.
 *
 * The port does matter here, unlike in the Host check: another server on loopback is a different
 * origin and has no business writing to this run. It is read from the accepting socket rather than
 * from configuration, so it is right even on an ephemeral port.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true; // non-browser client: curl, a script, the CLI itself
  try {
    const u = new URL(origin);
    return ALLOWED_HOSTS.has(u.hostname) && u.port === String(port);
  } catch {
    return false;
  }
}
