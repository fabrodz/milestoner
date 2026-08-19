export const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dogwatch</title>
<style>
:root{
  --bg:#fbfbfa;--fg:#1c1c1a;--muted:#6b6b66;--line:#e2e2dd;--panel:#fff;
  --done:#3f7d51;--blocked:#b4453c;--incomplete:#b07d2b;--infra:#8a8a84;--progress:#3b6ea5;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#161714;--fg:#e8e8e3;--muted:#9a9a92;--line:#2e2f2b;--panel:#1e201c;
  --done:#6aa87c;--blocked:#d4726a;--incomplete:#d0a054;--infra:#75756e;--progress:#6f9fd0;}}
*{box-sizing:border-box}
body{margin:0;padding:1.4rem 1rem 4rem;background:var(--bg);color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:56rem;margin:0 auto}
h1{font-size:1.15rem;margin:0;font-weight:600;letter-spacing:-.01em}
h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:1.8rem 0 .5rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:.6rem;padding:1rem 1.15rem;margin-bottom:.7rem}
.row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.muted{color:var(--muted)}
.small{font-size:.85rem}

/* the answer to "how is it going", in words, before anything else */
.verdict{border-left:4px solid var(--infra);padding:.9rem 1.1rem;margin-bottom:.9rem}
.verdict.ok{border-color:var(--done)}
.verdict.warn{border-color:var(--incomplete)}
.verdict.bad{border-color:var(--blocked)}
.verdict .what{font-size:1.35rem;font-weight:600;letter-spacing:-.01em;line-height:1.25}
.verdict .why{color:var(--muted);margin-top:.3rem;font-size:.92rem}
.todo{margin-top:.8rem;padding:.65rem .85rem;border-radius:.4rem;font-size:.93rem;
  background:color-mix(in srgb,var(--blocked) 10%,transparent)}
.todo b{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  margin-bottom:.2rem;font-weight:600}

.pill{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:.15rem .5rem;
  border-radius:1rem;color:#fff;background:var(--infra);white-space:nowrap}
.pill.done{background:var(--done)}.pill.blocked{background:var(--blocked)}
.pill.in_progress{background:var(--progress)}.pill.pending{background:var(--infra)}
.pill.incomplete{background:var(--incomplete)}.pill.infrastructure{background:var(--infra)}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.6rem;margin-bottom:1rem}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.65rem .8rem}
.stat .v{font-size:1.3rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}
.stat .k{color:var(--muted);font-size:.78rem;margin-top:.15rem}

.ms{border-left:3px solid transparent}
.ms.done{border-left-color:var(--done)}.ms.blocked{border-left-color:var(--blocked)}
.ms.in_progress{border-left-color:var(--progress)}
ul.ev{margin:.5rem 0 0;padding-left:1.15rem;font-size:.9rem}
ul.ev li{margin-bottom:.25rem}
.tried{font-size:.88rem;color:var(--muted);margin-top:.5rem}

table.att{width:100%;border-collapse:collapse;margin-top:.8rem;font-size:.85rem}
table.att th{text-align:left;font-weight:500;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);border-bottom:1px solid var(--line);padding:0 .6rem .25rem 0}
table.att td{padding:.35rem .6rem .35rem 0;border-bottom:1px solid var(--line);vertical-align:top}
table.att tr:last-child td{border-bottom:none}

button{font:inherit;font-size:.85rem;padding:.38rem .85rem;border:1px solid var(--line);border-radius:.4rem;
  background:var(--panel);color:var(--fg);cursor:pointer}
button:hover:not(:disabled){border-color:var(--muted)}
button:disabled{opacity:.35;cursor:not-allowed}
button.primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}
button.danger{color:var(--blocked);border-color:color-mix(in srgb,var(--blocked) 40%,var(--line))}
button.link{border:none;background:none;padding:0;color:var(--progress);text-decoration:underline;
  font-size:.84rem;cursor:pointer}
textarea{font:inherit;font-size:.9rem;width:100%;min-height:4rem;padding:.55rem .65rem;resize:vertical;
  border:1px solid var(--line);border-radius:.4rem;background:var(--bg);color:var(--fg)}
pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem;overflow:auto;margin:0;
  padding:.7rem .8rem;background:color-mix(in srgb,var(--fg) 4%,transparent);border-radius:.35rem;max-height:26rem}
time{cursor:help;border-bottom:1px dotted var(--line)}
#toast{position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);background:var(--fg);color:var(--bg);
  padding:.55rem .95rem;border-radius:.4rem;font-size:.88rem;opacity:0;transition:opacity .2s;
  pointer-events:none;max-width:90vw}
#toast.on{opacity:1}
</style>
</head>
<body>
<main>
  <div class="row" style="margin-bottom:.9rem">
    <h1 id="run">connecting…</h1>
    <span class="muted small" id="conn" style="margin-left:auto"></span>
  </div>

  <div class="card verdict" id="verdict"></div>
  <div class="card" id="controls"></div>
  <div class="stats" id="stats"></div>

  <h2>Milestones</h2>
  <div id="milestones"></div>

  <h2>Steering<span class="muted" style="text-transform:none;letter-spacing:0"> — a correction every session launched from now on will see</span></h2>
  <div class="card">
    <textarea id="steerText" placeholder="It overrides the milestone prompt. It does not allow dropping an acceptance criterion: a steer that makes the milestone impossible comes back as blocked."></textarea>
    <div class="row" style="margin-top:.55rem">
      <button data-w onclick="steer(false)">Replace</button>
      <button data-w onclick="steer(true)">Add a line</button>
      <button data-w onclick="post('/api/steer',{clear:true})">Clear</button>
      <span class="muted small" id="steerNow" style="margin-left:auto"></span>
    </div>
  </div>

  <div class="card" id="logView" style="display:none">
    <div class="row"><strong>Session transcript</strong><span class="muted small" id="logName"></span>
      <button style="margin-left:auto" onclick="closeLog()">Close</button></div>
    <pre id="logBody" style="margin-top:.6rem"></pre>
  </div>

  <h2>What the engine did</h2>
  <div class="card"><table class="att" id="activity"></table></div>

  <h2>Interventions</h2>
  <div class="card"><div id="interventions" class="small"></div></div>

  <p class="small muted" style="margin-top:1.5rem"><a id="reportLink" href="#">Open the full report, with the timeline</a></p>
</main>
<div id="toast"></div>
<script>
const TOKEN = new URLSearchParams(location.search).get("token") || "";
const auth = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function dur(s) {
  if (s == null) return "-";
  if (s < 60) return s + " sec";
  if (s < 3600) return Math.round(s / 60) + " min";
  const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
  return h + "h" + (m ? " " + m + "m" : "");
}
/** Relative time is what you can read half-awake; the exact stamp stays on hover. */
function ago(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  const rel = s < 45 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago"
    : s < 172800 ? Math.round(s / 3600) + " hours ago" : Math.round(s / 86400) + " days ago";
  return '<time title="' + esc(iso) + '">' + rel + "</time>";
}

const OUTCOME = { done:"finished", blocked:"blocked", incomplete:"did not finish", "infra-failure":"infrastructure" };
const OUTCOME_CLASS = { done:"done", blocked:"blocked", incomplete:"incomplete", "infra-failure":"infrastructure" };

/** run-log.md lines are "time | milestone | event | detail", written for machines. This is for you. */
function readEvent(ev, detail) {
  if (ev === "launch") return ["Started a session", detail];
  if (ev === "done") return ["Milestone finished", detail];
  if (ev === "blocked") return ["Reported blocked", detail];
  if (ev === "incomplete") return ["Session ended without finishing", detail];
  if (ev === "killed") return ["Session killed by a supervisor", detail];
  if (ev === "interrupted") return ["Interrupted", detail];
  if (ev === "run-complete") return ["Run complete", detail];
  if (ev === "attempts-exhausted") return ["Out of attempts, marked blocked", detail];
  if (ev === "infra-exhausted") return ["Too many infrastructure failures, gave up", detail];
  if (ev === "infra:usage-limit") return ["Hit a usage limit", detail + " — no attempt was charged"];
  if (ev === "infra:agent-failure") return ["The agent could not run", detail + " — no attempt was charged"];
  if (ev === "infra:instant-death") return ["The session died on startup", detail + " — no attempt was charged"];
  return [ev, detail];
}
function parseLog(lines) {
  return lines.map(l => {
    const parts = l.split(" | ");
    if (parts.length < 4) return null;
    const [what, why] = readEvent(parts[2].trim(), parts.slice(3).join(" | ").trim());
    return { at: parts[0].trim(), who: parts[1].trim(), what, why };
  }).filter(Boolean).reverse();
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3500);
}
async function post(path, body) {
  try {
    const r = await fetch(path, { method: "POST", headers: auth, body: JSON.stringify(body || {}) });
    const d = await r.json();
    toast(d.message || d.error || (r.ok ? "done" : "failed"));
  } catch (e) { toast("request failed: " + e.message); }
}
function steer(append) {
  const text = document.getElementById("steerText").value.trim();
  if (!text) return toast("nothing to send");
  post("/api/steer", { text, append });
  if (!append) document.getElementById("steerText").value = "";
}
function killAgent() {
  const reason = prompt("Why is this session being killed? It goes in the intervention log.", "no progress for a long time");
  if (reason !== null) post("/api/kill", { reason: reason || "killed from the panel" });
}
async function viewLog(name) {
  const box = document.getElementById("logView"), body = document.getElementById("logBody");
  document.getElementById("logName").textContent = name;
  body.textContent = "loading…";
  box.style.display = "block";
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await fetch("/api/transcript?token=" + encodeURIComponent(TOKEN) + "&name=" + encodeURIComponent(name), { headers: auth });
    body.textContent = r.ok ? await r.text() : "could not read it: " + (await r.json()).error;
    body.scrollTop = body.scrollHeight; // read to find out how it ended
  } catch (e) { body.textContent = "request failed: " + e.message; }
}
function closeLog() { document.getElementById("logView").style.display = "none"; }

/** One sentence for "how is it going", and, when it needs you, exactly what to do. */
function verdictOf(d) {
  const blocked = d.milestones.find(m => m.status === "blocked");
  const p = d.pulse;
  if (d.runComplete)
    return { cls:"ok", what:"All " + d.total + " milestones are done.", why:"Nothing left to run.", todo:null };
  if (blocked) {
    const dg = blocked.diagnosis;
    return { cls:"bad",
      what:"Stopped at " + blocked.id + ". It needs you.",
      why: dg ? dg.symptom : "The session did not write a diagnosis; read its transcript below.",
      todo: dg ? dg.userAction : null };
  }
  if (p && p.runnerAlive) {
    const stale = d.liveness && d.liveness.ageSeconds > 900;
    return { cls: stale ? "warn" : "ok",
      what:"Working on " + (p.milestoneId || "a milestone") + ", attempt " + (p.attempt ?? "?") + ".",
      why:"Session running for " + dur(p.sessionSeconds) +
        (d.liveness ? ", last sign of work " + dur(d.liveness.ageSeconds) + " ago in " + esc(d.liveness.path)
                    : ", no liveness paths configured so there is no sign of work to check") +
        (stale ? ". That is longer than usual — it may be stuck." : "."),
      todo:null };
  }
  return { cls:"warn",
    what:"Nothing is running. " + d.done + " of " + d.total + " milestones done.",
    why:"No runner process is alive, so the run is not advancing.",
    todo:null };
}

function render(d) {
  document.getElementById("run").textContent = d.run;
  document.getElementById("conn").textContent = "updated " + new Date().toTimeString().slice(0, 5);
  document.getElementById("reportLink").href = "/api/report?token=" + encodeURIComponent(TOKEN);

  const v = verdictOf(d);
  document.getElementById("verdict").className = "card verdict " + v.cls;
  document.getElementById("verdict").innerHTML =
    '<div class="what">' + esc(v.what) + '</div><div class="why">' + v.why + "</div>" +
    (v.todo ? '<div class="todo"><b>What to do</b>' + esc(v.todo) + "</div>" : "");

  const running = d.pulse && d.pulse.runnerAlive;
  document.getElementById("controls").innerHTML =
    '<div class="row">' +
    (running
      ? '<button data-w onclick="post(\'/api/run/stop\')">Stop after this session</button>' +
        '<button data-w class="danger" onclick="killAgent()">Kill this session and retry</button>'
      : '<button data-w class="primary" onclick="post(\'/api/run/start\')">Start the run</button>') +
    (d.attendConfigured ? '<button data-w onclick="post(\'/api/attend\',{})">Unstick the environment</button>' : "") +
    (d.pulse && d.pulse.transcript ? '<button class="link" style="margin-left:auto" onclick="viewLog(' + JSON.stringify(d.pulse.transcript) + ')">watch the live transcript</button>' : "") +
    "</div>";

  const sessions = d.milestones.reduce((n, m) => n + m.history.length, 0);
  const infra = d.milestones.reduce((n, m) => n + m.history.filter(h => h.outcome === "infra-failure").length, 0);
  document.getElementById("stats").innerHTML = [
    [d.done + " of " + d.total, "milestones finished"],
    [sessions, "agent sessions run"],
    [infra, infra === 1 ? "failure that was not the agent's fault" : "failures that were not the agent's fault"],
    [d.milestones.reduce((n, m) => n + m.evidence.length, 0), "pieces of written evidence"],
  ].map(([v, k]) => '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + "</div></div>").join("");

  document.getElementById("milestones").innerHTML = d.milestones.map(m => {
    const dg = m.diagnosis
      ? '<div class="todo" style="margin-top:.7rem"><b>What to do</b>' + esc(m.diagnosis.userAction) + "</div>" +
        (m.diagnosis.tried && m.diagnosis.tried.length ? '<div class="tried">Already tried: ' + esc(m.diagnosis.tried.join("; ")) + "</div>" : "")
      : "";
    const ev = m.evidence.length
      ? "<h2 style='margin:.9rem 0 0'>Evidence</h2><ul class='ev'>" + m.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul>"
      : "";
    const att = m.history.length
      ? '<table class="att"><thead><tr><th>Attempt</th><th>Result</th><th>Took</th><th>When</th><th>Agent</th><th></th></tr></thead><tbody>' +
        m.history.map(h =>
          "<tr><td>#" + h.attempt + '</td><td><span class="pill ' + esc(OUTCOME_CLASS[h.outcome] || "") + '">' +
          esc(OUTCOME[h.outcome] || h.outcome) + "</span></td><td>" + dur(h.seconds) + "</td><td>" + ago(h.endedAt) +
          "</td><td>" + esc(h.agent || "-") + '</td><td><button class="link" onclick="viewLog(' +
          JSON.stringify(h.transcript) + ')">transcript</button></td></tr>' +
          (h.detail ? '<tr><td></td><td colspan="5" class="muted small">' + esc(h.detail) + "</td></tr>" : "") +
          (h.steering ? '<tr><td></td><td colspan="5" class="muted small">saw the steering: ' + esc(h.steering) + "</td></tr>" : "")
        ).join("") + "</tbody></table>"
      : '<p class="muted small" style="margin:.5rem 0 0">Not started yet.</p>';
    const un = m.status === "blocked"
      ? '<div class="row" style="margin-top:.8rem"><button data-w class="primary" onclick="post(\'/api/unblock\',{id:' + JSON.stringify(m.id) + '})">I fixed it, try again</button>' +
        '<button data-w onclick="post(\'/api/unblock\',{id:' + JSON.stringify(m.id) + ',keepAttempts:true})">Try again, keep the attempts used</button></div>'
      : "";
    const spent = m.attempts > 0 ? m.attempts + " of " + d.maxAttempts + " attempts used" : "no attempts used";
    return '<div class="card ms ' + esc(m.status) + '"><div class="row"><span class="pill ' + esc(m.status) + '">' +
      esc(m.status.replace("_", " ")) + '</span><strong>' + esc(m.id) + "</strong> " + esc(m.title) +
      '<span class="muted small" style="margin-left:auto">' + esc(spent) +
      (m.finishedAt ? " · finished " : "") + (m.finishedAt ? ago(m.finishedAt) : "") + "</span></div>" +
      dg + ev + att + un + "</div>";
  }).join("");

  document.getElementById("steerNow").textContent = d.steering ? "a steer is in force" : "no steer in force";
  if (d.steering && !document.getElementById("steerText").value) {
    const body = d.steering.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (body) document.getElementById("steerText").value = body;
  }

  const rows = parseLog(d.runLog);
  document.getElementById("activity").innerHTML = rows.length
    ? "<tbody>" + rows.map(r =>
        "<tr><td class='muted' style='white-space:nowrap'>" + ago(r.at) + "</td><td><strong>" + esc(r.who) +
        "</strong></td><td>" + esc(r.what) + '</td><td class="muted">' + esc(r.why) + "</td></tr>").join("") + "</tbody>"
    : "<tbody><tr><td class='muted'>Nothing has happened yet.</td></tr></tbody>";

  document.getElementById("interventions").innerHTML = d.supervisorLog.length
    ? d.supervisorLog.map(l => { const parts = l.split(" | ");
        return '<div style="margin-bottom:.3rem">' + ago(parts[0]) + ' <strong>' + esc(parts[1] || "") + "</strong> " +
               esc(parts.slice(2).join(" - ")) + "</div>"; }).join("")
    : '<span class="muted">Nobody has intervened in this run.</span>';

  document.querySelectorAll("[data-w]").forEach(b => { b.disabled = !d.writable; });
  if (!d.writable && !document.getElementById("roNote")) {
    const n = document.createElement("p");
    n.id = "roNote"; n.className = "muted small";
    n.textContent = "This panel can only read. Restart it with --write to enable the buttons.";
    document.getElementById("verdict").after(n);
  }
}

const es = new EventSource("/api/events?token=" + encodeURIComponent(TOKEN));
es.onmessage = e => render(JSON.parse(e.data));
es.onerror = () => { document.getElementById("conn").textContent = "connection lost, retrying…"; };
</script>
</body>
</html>`;
