/**
 * Reading a session transcript as the session, rather than as its wire format.
 *
 * A stream-json transcript is NDJSON: one event per line, opening with a multi-kilobyte inventory
 * of every tool, skill and slash command the machine has installed, and carrying every tool result
 * verbatim. Raw, it is unreadable by a person and expensive for a supervisor - the agent that would
 * most like to know what the session is doing is the one that can least afford to read it.
 *
 * This is the one place that knows the format. The panel serves it, `milestoner transcript` prints
 * it, and neither carries a parser of its own: a second one is a second thing to teach every time
 * the harness adds an event type.
 *
 * Nothing here is Claude-specific by construction. An agent whose output is plain text, or NDJSON
 * of some other shape, has no top-level `type` on its lines and comes back exactly as it was
 * written - which for an agent that already speaks prose is the right answer.
 */

/** One NDJSON event, or null for a line that is not one: prose, a partial write, another shape. */
export function parseEvent(line: string): Record<string, unknown> | null {
  if (line.charCodeAt(0) !== 123) return null;
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return typeof (value as { type?: unknown }).type === "string" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function oneLine(value: unknown, max: number): string {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function contentBlocks(event: Record<string, unknown>): unknown[] | null {
  const message = event.message as { content?: unknown } | undefined;
  if (!message || typeof message !== "object") return null;
  return Array.isArray(message.content) ? message.content : null;
}

function renderBlock(block: unknown): string | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;
  if (b.type === "text") return typeof b.text === "string" && b.text.trim() ? b.text.trim() : null;
  if (b.type === "thinking") return typeof b.thinking === "string" && b.thinking.trim() ? `(thinking) ${b.thinking.trim()}` : null;
  if (b.type === "tool_use") return `> ${String(b.name ?? "tool")} ${oneLine(JSON.stringify(b.input ?? {}), 200)}`;
  if (b.type === "tool_result") return `< ${oneLine(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 240)}`;
  return null;
}

/**
 * The transcript as prose. A transcript carrying no events at all is passed through untouched: an
 * agent that does not speak this format still has to be watchable.
 */
export function renderTranscript(raw: string): string {
  const out: string[] = [];
  let events = 0;

  for (const line of (raw || "").split("\n")) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      out.push(line);
      continue;
    }
    events += 1;

    if (event.type === "system") {
      // Only init is the session announcing itself. The other subtypes a real session emits are
      // telemetry - thinking_tokens arrives every few turns - and belong nowhere in a reading view.
      if (event.subtype === "init") {
        out.push(`- session started${event.model ? ` on ${String(event.model)}` : ""}${event.cwd ? ` in ${String(event.cwd)}` : ""}`);
      }
      continue;
    }

    if (event.type === "result") {
      const secs = typeof event.duration_ms === "number" ? ` after ${Math.round(event.duration_ms / 1000)}s` : "";
      const turns = typeof event.num_turns === "number" ? `, ${event.num_turns} turns` : "";
      out.push(`- session ended${event.is_error ? " with an error" : ""}${secs}${turns}`);
      continue;
    }

    for (const block of contentBlocks(event) ?? []) {
      const rendered = renderBlock(block);
      if (rendered) out.push(rendered);
    }
  }

  return events ? out.join("\n\n") : raw || "";
}
