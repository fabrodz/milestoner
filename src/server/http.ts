import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  doAttend, doKill, doSteer, doUnblock, reportHtml, snapshot, startRun, stopRun, transcript,
  type ActionResult, type ApiContext,
} from "./api.js";
import { BIND_HOST, hostAllowed, originAllowed, tokenFrom, tokenMatches } from "./security.js";
import { PAGE } from "./page.js";

const MAX_BODY = 64 * 1024;

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

export interface ServerOptions {
  ctx: ApiContext;
  port: number;
  token: string;
  /** When false every mutating route answers 403 and the page hides its controls. */
  allowWrites: boolean;
}

export function createPanel(options: ServerOptions) {
  const { ctx, token, port } = options;

  return createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${BIND_HOST}:${port}`);

    if (!hostAllowed(req.headers.host)) return json(res, 403, { error: "unexpected Host header" });
    if (!tokenMatches(token, tokenFrom(req, url))) return json(res, 401, { error: "bad or missing token" });

    const path = url.pathname;

    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
    if (req.method === "GET" && path === "/api/state") return json(res, 200, { ...snapshot(ctx), writable: options.allowWrites });
    if (req.method === "GET" && path === "/api/report") return send(res, 200, "text/html; charset=utf-8", reportHtml(ctx));
    if (req.method === "GET" && path === "/api/transcript") {
      const body = transcript(ctx, url.searchParams.get("name") ?? "");
      return body === null ? json(res, 404, { error: "no such transcript" }) : send(res, 200, "text/plain; charset=utf-8", body);
    }
    if (req.method === "GET" && path === "/api/events") return stream(req, res);

    if (req.method === "POST") {
      if (!options.allowWrites) return json(res, 403, { error: "this panel is read-only; restart with --write" });
      // The port the request actually arrived on, not the one we asked for.
      if (!originAllowed(req.headers.origin, req.socket.localPort ?? port)) return json(res, 403, { error: "unexpected Origin" });

      const body = await readBody(req);
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
      const bool = (k: string) => body[k] === true;

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
          result = doKill(ctx, str("reason") ?? "killed from the web panel");
          break;
        case "/api/attend": {
          const raw = body.seconds;
          const seconds = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
          result = doAttend(ctx, seconds);
          break;
        }
        case "/api/run/start":
          result = startRun(ctx);
          break;
        case "/api/run/stop":
          result = stopRun(ctx);
          break;
        default:
          return json(res, 404, { error: "no such endpoint" });
      }
      return json(res, result.ok ? 200 : 409, result);
    }

    json(res, 404, { error: "no such endpoint" });
  }

  /**
   * Server-sent events driven by `rev`, not by fs.watch: watching is unreliable across platforms and
   * fires several times per atomic rename, while the revision is exactly the question being asked.
   */
  function stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });

    let lastRev = -1;
    const tick = () => {
      try {
        const state = snapshot(ctx);
        // Also re-send while a session is live: the pulse moves without state.json changing.
        if (state.rev !== lastRev || state.pulse?.runnerAlive) {
          lastRev = state.rev;
          res.write(`data: ${JSON.stringify({ ...state, writable: options.allowWrites })}\n\n`);
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
