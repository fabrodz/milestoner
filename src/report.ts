import type { AttemptRecord, Milestone, RunState } from "./types.js";

export interface ReportInput {
  state: RunState;
  runLog: string[];
  supervisorLog: string[];
  generatedAt: Date;
}

const OUTCOME_LABEL: Record<AttemptRecord["outcome"], string> = {
  done: "done",
  blocked: "blocked",
  incomplete: "incomplete",
  "infra-failure": "infrastructure",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function attemptsOf(state: RunState): AttemptRecord[] {
  return state.milestones.flatMap((m) => m.history);
}

interface Window {
  from: number;
  to: number;
}

function runWindow(state: RunState, now: Date): Window {
  const stamps = attemptsOf(state).flatMap((a) => [Date.parse(a.startedAt), Date.parse(a.endedAt)]).filter(Number.isFinite);
  const from = stamps.length ? Math.min(...stamps) : Date.parse(state.createdAt) || now.getTime();
  const to = stamps.length ? Math.max(...stamps) : now.getTime();
  return { from, to: to > from ? to : from + 1000 };
}

function timelineRow(milestone: Milestone, window: Window): string {
  const span = window.to - window.from;
  const segments = milestone.history
    .map((a) => {
      const start = Date.parse(a.startedAt);
      const end = Date.parse(a.endedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
      const left = ((start - window.from) / span) * 100;
      const width = Math.max(((end - start) / span) * 100, 0.4);
      const title = `attempt ${a.attempt}: ${OUTCOME_LABEL[a.outcome]}, ${duration(end - start)}`;
      return `<span class="seg ${a.outcome}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeHtml(title)}"></span>`;
    })
    .join("");
  return `<div class="track-row"><span class="track-id">${escapeHtml(milestone.id)}</span><span class="track">${segments}</span></div>`;
}

function attemptTable(milestone: Milestone): string {
  if (milestone.history.length === 0) return "";
  const rows = milestone.history
    .map((a) => {
      const steering = a.steering ? `<div class="steer">steering: ${escapeHtml(a.steering)}</div>` : "";
      const detail = a.detail ? `<div class="detail">${escapeHtml(a.detail)}</div>` : "";
      return `<tr>
        <td>${a.attempt}</td>
        <td><span class="pill ${a.outcome}">${OUTCOME_LABEL[a.outcome]}</span></td>
        <td>${a.seconds}s</td>
        <td>${a.exitCode === null ? "-" : a.exitCode}</td>
        <td class="mono">${escapeHtml(a.transcript)}${detail}${steering}</td>
      </tr>`;
    })
    .join("");
  return `<table class="attempts">
    <thead><tr><th>#</th><th>outcome</th><th>time</th><th>exit</th><th>transcript</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function milestoneCard(milestone: Milestone, maxAttempts: number): string {
  const evidence = milestone.evidence.length
    ? `<ul class="evidence">${milestone.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
    : `<p class="none">no evidence recorded</p>`;

  const diagnosis = milestone.diagnosis
    ? `<div class="diagnosis">
        <div><span class="k">symptom</span> ${escapeHtml(milestone.diagnosis.symptom)}</div>
        ${milestone.diagnosis.tried.length ? `<div><span class="k">tried</span> ${escapeHtml(milestone.diagnosis.tried.join(" | "))}</div>` : ""}
        <div><span class="k">user action</span> <strong>${escapeHtml(milestone.diagnosis.userAction)}</strong></div>
      </div>`
    : "";

  const wasted = milestone.history.filter((a) => a.outcome === "infra-failure").length;
  const meta = [
    `${milestone.attempts}/${maxAttempts} attempts`,
    milestone.finishedAt ? `finished ${escapeHtml(milestone.finishedAt.slice(0, 16).replace("T", " "))}` : null,
    wasted ? `${wasted} infrastructure ${wasted === 1 ? "retry" : "retries"} (not charged)` : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  return `<section class="card ${milestone.status}">
    <header>
      <span class="pill ${milestone.status}">${milestone.status.replace("_", " ")}</span>
      <h3>${escapeHtml(milestone.id)} &middot; ${escapeHtml(milestone.title)}</h3>
    </header>
    <p class="meta">${meta}</p>
    ${diagnosis}
    <h4>Evidence</h4>
    ${evidence}
    ${attemptTable(milestone)}
  </section>`;
}

function logBlock(title: string, lines: string[], empty: string): string {
  const body = lines.length
    ? `<pre>${lines.map((l) => escapeHtml(l)).join("\n")}</pre>`
    : `<p class="none">${escapeHtml(empty)}</p>`;
  return `<section class="card log"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

export function buildReport(input: ReportInput): string {
  const { state, generatedAt } = input;
  const done = state.milestones.filter((m) => m.status === "done").length;
  const blocked = state.milestones.filter((m) => m.status === "blocked");
  const window = runWindow(state, generatedAt);
  const attempts = attemptsOf(state);
  const worked = attempts.filter((a) => a.outcome !== "infra-failure");
  const sessionSeconds = worked.reduce((sum, a) => sum + a.seconds, 0);

  const verdict = state.runComplete
    ? { label: "run complete", cls: "done" }
    : blocked.length
      ? { label: `blocked at ${blocked[0]?.id ?? "?"}`, cls: "blocked" }
      : { label: "in progress", cls: "in_progress" };

  const stats = [
    { k: "milestones", v: `${done}/${state.milestones.length}` },
    { k: "sessions", v: String(attempts.length) },
    { k: "session time", v: duration(sessionSeconds * 1000) },
    { k: "wall clock", v: duration(window.to - window.from) },
    { k: "infrastructure retries", v: String(attempts.length - worked.length) },
    { k: "evidence lines", v: String(state.milestones.reduce((n, m) => n + m.evidence.length, 0)) },
  ];

  const maxAttempts = Math.max(1, ...state.milestones.map((m) => m.attempts));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>pulseflow - ${escapeHtml(state.run)}</title>
<style>
:root {
  --bg: #fbfbfa; --fg: #1c1c1a; --muted: #6b6b66; --line: #e2e2dd; --panel: #ffffff;
  --done: #3f7d51; --blocked: #b4453c; --incomplete: #b07d2b; --infra: #8a8a84; --progress: #3b6ea5;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161714; --fg: #e8e8e3; --muted: #9a9a92; --line: #2e2f2b; --panel: #1e201c;
    --done: #6aa87c; --blocked: #d4726a; --incomplete: #d0a054; --infra: #75756e; --progress: #6f9fd0; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 62rem; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
h3 { font-size: 1rem; margin: 0; }
h4 { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 1.1rem 0 .35rem; }
.sub { color: var(--muted); margin: 0 0 1.6rem; font-size: .9rem; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: .75rem; margin-bottom: 1.75rem; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: .5rem; padding: .7rem .85rem; }
.stat .v { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat .k { color: var(--muted); font-size: .74rem; text-transform: uppercase; letter-spacing: .05em; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: .6rem; padding: 1rem 1.15rem; margin-bottom: 1rem; }
.card header { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.card.blocked { border-color: var(--blocked); }
.meta { color: var(--muted); font-size: .84rem; margin: .45rem 0 0; }
.pill { font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  padding: .16rem .5rem; border-radius: 1rem; color: #fff; background: var(--infra); white-space: nowrap; }
.pill.done { background: var(--done); } .pill.blocked { background: var(--blocked); }
.pill.incomplete { background: var(--incomplete); } .pill.in_progress { background: var(--progress); }
.pill.pending { background: var(--infra); } .pill.infra-failure { background: var(--infra); }
.evidence { margin: .3rem 0 0; padding-left: 1.1rem; }
.evidence li { margin-bottom: .3rem; }
.none { color: var(--muted); font-style: italic; margin: .3rem 0 0; }
.diagnosis { border-left: 3px solid var(--blocked); padding: .5rem .8rem; margin-top: .8rem;
  background: color-mix(in srgb, var(--blocked) 8%, transparent); border-radius: 0 .3rem .3rem 0; font-size: .9rem; }
.diagnosis .k { color: var(--muted); display: inline-block; min-width: 6rem; font-size: .78rem;
  text-transform: uppercase; letter-spacing: .05em; }
.timeline { display: flex; flex-direction: column; gap: .3rem; }
.track-row { display: flex; align-items: center; gap: .6rem; }
.track-id { width: 3.5rem; flex: none; font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.track { position: relative; height: 1.1rem; flex: 1; background: color-mix(in srgb, var(--fg) 6%, transparent); border-radius: .25rem; }
.seg { position: absolute; top: 0; height: 100%; border-radius: .2rem; background: var(--infra); min-width: 2px; }
.seg.done { background: var(--done); } .seg.blocked { background: var(--blocked); }
.seg.incomplete { background: var(--incomplete); } .seg.infra-failure { background: var(--infra); opacity: .55; }
.legend { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--muted); font-size: .78rem; margin-top: .8rem; }
.legend span::before { content: ""; display: inline-block; width: .7rem; height: .7rem; border-radius: .15rem; margin-right: .35rem; vertical-align: middle; }
.legend .l-done::before { background: var(--done); } .legend .l-incomplete::before { background: var(--incomplete); }
.legend .l-blocked::before { background: var(--blocked); } .legend .l-infra::before { background: var(--infra); opacity: .55; }
table.attempts { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: .85rem; }
table.attempts th { text-align: left; color: var(--muted); font-weight: 500; font-size: .74rem;
  text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--line); padding: .3rem .5rem .3rem 0; }
table.attempts td { padding: .4rem .5rem .4rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.mono, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .8rem; }
.detail, .steer { color: var(--muted); font-size: .78rem; margin-top: .15rem; }
pre { overflow-x: auto; margin: .5rem 0 0; padding: .7rem .8rem; background: color-mix(in srgb, var(--fg) 4%, transparent);
  border-radius: .35rem; white-space: pre; }
footer { color: var(--muted); font-size: .8rem; margin-top: 2rem; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(state.run)} <span class="pill ${verdict.cls}">${escapeHtml(verdict.label)}</span></h1>
  <p class="sub">started ${escapeHtml(state.createdAt.slice(0, 16).replace("T", " "))} &middot; report generated ${escapeHtml(
    generatedAt.toISOString().slice(0, 16).replace("T", " "),
  )}</p>

  <div class="stats">
    ${stats.map((s) => `<div class="stat"><div class="v">${escapeHtml(s.v)}</div><div class="k">${escapeHtml(s.k)}</div></div>`).join("")}
  </div>

  <section class="card">
    <h3>Timeline</h3>
    <p class="meta">Every session that ran, placed on the run's wall clock. Gaps are waits: usage limits, retry delays, a runner that was not running.</p>
    <div class="timeline" style="margin-top:.9rem">${state.milestones.map((m) => timelineRow(m, window)).join("")}</div>
    <div class="legend"><span class="l-done">done</span><span class="l-incomplete">incomplete</span><span class="l-blocked">blocked</span><span class="l-infra">infrastructure, attempt not charged</span></div>
  </section>

  ${state.milestones.map((m) => milestoneCard(m, maxAttempts)).join("")}

  ${logBlock("Interventions", input.supervisorLog, "no supervisor intervened in this run")}
  ${logBlock("Engine events", input.runLog, "no engine events recorded")}

  <footer>pulseflow report &middot; ${escapeHtml(String(state.milestones.length))} milestones &middot; generated locally, no external assets</footer>
</main>
</body>
</html>
`;
}
