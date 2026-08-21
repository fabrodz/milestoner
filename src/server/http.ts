import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "../config.js";
import { layoutFor, samePath } from "../paths.js";
import { listRuns, summariseUnregistered, type RunSummary, type SeenRun } from "../registry.js";
import {
  doAttend, doKill, doSteer, doUnblock, reportHtml, snapshot, startRun, stopRun, transcript,
  type ActionResult, type ApiContext,
} from "./api.js";
import { BIND_HOST, TOKEN_COOKIE, hostAllowed, newToken, originAllowed, tokenFrom, tokenMatches } from "./security.js";
import { PAGE } from "./page.js";

const MAX_BODY = 64 * 1024;
const ONCE_TTL_MS = 2 * 60 * 1000;

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    // The panel is entirely self-contained; nothing should be loadable from or into anywhere else.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, "application/json", JSON.stringify(value));

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

/**
 * What one server answers for: the project it was started in, or every run the machine registry
 * knows about. The machine scope resolves projects per request, because which runs exist changes
 * while the panel is up - that is the point of it.
 */
export type PanelScope =
  | { kind: "project"; ctx: ApiContext }
  | { kind: "machine"; registry: string; cliPath: string };

export interface ServerOptions {
  scope: PanelScope;
  port: number;
  token: string;
  /** When false every mutating route answers 403 and the page hides its controls. */
  allowWrites: boolean;
  /** When false the start-run control is gone: a runner already owns this directory. See D-027. */
  allowStart?: boolean;
}

const NO_SECOND_RUNNER =
  "this panel came up with the run, and that runner owns it - a second one would be two runners on one state.json";

export function createPanel(options: ServerOptions) {
  const { scope, token, port } = options;
  const canStart = options.allowStart !== false;

  /** Single-use tokens for /auth, so a browser can be opened without the key in its URL. */
  const onceTokens = new Map<string, number>();

  /** Every run this panel has seen registered, kept for its lifetime: see summariseUnregistered. */
  const seenRuns = new Map<string, SeenRun>();

  const runsListing = (): RunSummary[] => {
    if (scope.kind !== "machine") return [];
    const live = listRuns(scope.registry).runs;
    for (const r of live) {
      seenRuns.set(r.projectRoot, { run: r.run, projectRoot: r.projectRoot, pid: r.pid, startedAt: r.startedAt, lastSeen: r.lastSeen });
    }
    const finished = [...seenRuns.values()]
      .filter((s) => !live.some((r) => samePath(r.projectRoot, s.projectRoot)))
      .map(summariseUnregistered)
      .filter((s): s is RunSummary => s !== null);
    return [...live, ...finished];
  };

  /** null when the machine scope cannot resolve `root` to a registered project. */
  function contextFor(root: string | null, listing: RunSummary[]): ApiContext | null {
    if (scope.kind === "project") return scope.ctx;
    if (!root) return null;
    const match = listing.find((r) => samePath(r.projectRoot, root));
    if (!match) return null;
    try {
      const layout = layoutFor(match.projectRoot);
      return { config: loadConfig(layout.config, match.projectRoot), layout, cliPath: scope.cliPath };
    } catch {
      return null;
    }
  }

  const hubView = (listing: RunSummary[]): Record<string, unknown> => ({
    hub: true,
    rev: -1,
    runs: listing,
    writable: options.allowWrites,
    canStart,
  });

  function view(root: string | null): Record<string, unknown> | null {
    if (scope.kind === "project") {
      return { ...snapshot(scope.ctx), writable: options.allowWrites, canStart, hub: false, runs: null };
    }
    const listing = runsListing();
    if (!root) return hubView(listing);
    const ctx = contextFor(root, listing);
    if (!ctx) return null;
    return { ...snapshot(ctx), writable: options.allowWrites, canStart, hub: false, runs: listing };
  }

  return createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${BIND_HOST}:${port}`);

    if (!hostAllowed(req.headers.host)) return json(res, 403, { error: "unexpected Host header" });

    // Before the token gate: the once-token IS the credential here, already minted by a caller who
    // held the real one. Single use and short-lived, so the URL a browser keeps is a dead link.
    if (req.method === "GET" && url.pathname === "/auth") {
      const once = url.searchParams.get("once") ?? "";
      const expiry = onceTokens.get(once);
      onceTokens.delete(once);
      if (!once || expiry === undefined || expiry < Date.now()) {
        return json(res, 401, { error: "this link was already used or has expired - the CLI prints a fresh one" });
      }
      res.writeHead(303, {
        "set-cookie": `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        location: "/",
        "cache-control": "no-store",
      });
      res.end();
      return;
    }

    if (!tokenMatches(token, tokenFrom(req, url))) return json(res, 401, { error: "bad or missing token" });

    const path = url.pathname;
    const root = url.searchParams.get("root");

    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
    if (req.method === "GET" && path === "/api/state") {
      const state = view(root);
      return state === null ? json(res, 404, { error: "no such run is registered on this machine" }) : json(res, 200, state);
    }
    if (req.method === "GET" && path === "/api/events") return stream(req, res, root);

    const ctxOr = (fn: (ctx: ApiContext) => Promise<void> | void) => {
      const ctx = contextFor(root, runsListing());
      if (!ctx) return json(res, 404, { error: scope.kind === "machine" && !root ? "root is required" : "no such run is registered on this machine" });
      return fn(ctx);
    };

    if (req.method === "GET" && path === "/api/report") {
      return ctxOr((ctx) => send(res, 200, "text/html; charset=utf-8", reportHtml(ctx)));
    }
    if (req.method === "GET" && path === "/api/transcript") {
      return ctxOr((ctx) => {
        const body = transcript(ctx, url.searchParams.get("name") ?? "");
        return body === null ? json(res, 404, { error: "no such transcript" }) : send(res, 200, "text/plain; charset=utf-8", body);
      });
    }

    if (req.method === "POST") {
      // The port the request actually arrived on, not the one we asked for.
      if (!originAllowed(req.headers.origin, req.socket.localPort ?? port)) return json(res, 403, { error: "unexpected Origin" });

      // Minting an open-in-browser link is not a run mutation; a read-only panel can be opened too.
      if (path === "/api/once") {
        for (const [key, at] of onceTokens) if (at < Date.now()) onceTokens.delete(key);
        const once = newToken();
        onceTokens.set(once, Date.now() + ONCE_TTL_MS);
        return json(res, 200, { once });
      }

      if (!options.allowWrites) return json(res, 403, { error: "this panel is read-only; restart with --write" });

      const body = await readBody(req);
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
      const bool = (k: string) => body[k] === true;

      return ctxOr(async (ctx) => {
        let result: ActionResult;
        switch (path) {
          case "/api/steer":
            result = doSteer(ctx, str("text"), bool("append"), bool("clear"));
            break;
          case "/api/unblock": {
            const id = str("id");
            if (!id) return json(res, 400, { error: "id is required" });
            result = doUnblock(ctx, id, bool("keepAttempts"));
            break;
          }
          case "/api/kill":
            result = await doKill(ctx, str("reason") ?? "killed from the web panel");
            break;
          case "/api/attend": {
            const raw = body.seconds;
            const seconds = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
            result = doAttend(ctx, seconds);
            break;
          }
          case "/api/run/start":
            result = !canStart ? { ok: false, message: NO_SECOND_RUNNER } : startRun(ctx);
            break;
          case "/api/run/stop":
            result = stopRun(ctx);
            break;
          default:
            return json(res, 404, { error: "no such endpoint" });
        }
        return json(res, result.ok ? 200 : 409, result);
      });
    }

    json(res, 404, { error: "no such endpoint" });
  }

  /**
   * Server-sent events driven by `rev`, not by fs.watch: watching is unreliable across platforms and
   * fires several times per atomic rename, while the revision is exactly the question being asked.
   */
  function stream(req: IncomingMessage, res: ServerResponse, root: string | null): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });

    let lastRev = -1;
    const tick = () => {
      try {
        // A run whose registry entry expired falls back to the hub rather than going silent.
        const state = view(root) ?? (scope.kind === "machine" ? hubView(runsListing()) : null);
        if (!state) return void res.write("event: error\ndata: {}\n\n");
        const pulse = state.pulse as { runnerAlive?: boolean } | null | undefined;
        // Also re-send while a session is live: the pulse moves without state.json changing.
        // The hub has no rev of its own; its listing ages every tick, so it is always re-sent.
        if (state.rev !== lastRev || pulse?.runnerAlive || state.hub === true) {
          lastRev = state.rev as number;
          res.write(`data: ${JSON.stringify(state)}\n\n`);
        } else {
          // A comment keeps the connection provably alive. An idle run can go a long time without
          // a change, and a silent stream is indistinguishable from a dead one.
          res.write(": ping\n\n");
        }
      } catch {
        res.write("event: error\ndata: {}\n\n");
      }
    };

    tick();
    const timer = setInterval(tick, 2000);
    req.on("close", () => clearInterval(timer));
  }
}
