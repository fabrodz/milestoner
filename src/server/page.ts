export const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dogwatch</title>
<style>
:root {
  --bg:#fbfbfa; --fg:#1c1c1a; --muted:#6b6b66; --line:#e2e2dd; --panel:#fff;
  --done:#3f7d51; --blocked:#b4453c; --incomplete:#b07d2b; --infra:#8a8a84; --progress:#3b6ea5;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#161714; --fg:#e8e8e3; --muted:#9a9a92; --line:#2e2f2b; --panel:#1e201c;
  --done:#6aa87c; --blocked:#d4726a; --incomplete:#d0a054; --infra:#75756e; --progress:#6f9fd0;}}
*{box-sizing:border-box}
body{margin:0;padding:1.5rem 1rem 4rem;background:var(--bg);color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:60rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .1rem;letter-spacing:-.01em}
h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:1.6rem 0 .5rem}
.sub{color:var(--muted);font-size:.88rem;margin:0 0 1.2rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1rem;margin-bottom:.7rem}
.card.blocked{border-color:var(--blocked)}
.row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.pill{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:.15rem .5rem;
  border-radius:1rem;color:#fff;background:var(--infra);white-space:nowrap}
.pill.done{background:var(--done)}.pill.blocked{background:var(--blocked)}
.pill.in_progress{background:var(--progress)}.pill.pending{background:var(--infra)}
.pill.alive{background:var(--done)}.pill.dead{background:var(--blocked)}
.meta{color:var(--muted);font-size:.82rem;margin:.35rem 0 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));gap:.6rem;margin-bottom:1rem}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.6rem .75rem}
.stat .v{font-size:1.2rem;font-weight:600;font-variant-numeric:tabular-nums}
.stat .k{color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em}
ul.ev{margin:.3rem 0 0;padding-left:1.1rem;font-size:.9rem}
.diag{border-left:3px solid var(--blocked);padding:.4rem .7rem;margin-top:.6rem;font-size:.88rem;
  background:color-mix(in srgb,var(--blocked) 8%,transparent);border-radius:0 .3rem .3rem 0}
.diag .k{color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;
  display:inline-block;min-width:5.5rem}
button{font:inherit;font-size:.85rem;padding:.35rem .8rem;border:1px solid var(--line);border-radius:.4rem;
  background:var(--panel);color:var(--fg);cursor:pointer}
button:hover:not(:disabled){border-color:var(--muted)}
button:disabled{opacity:.4;cursor:not-allowed}
button.danger{color:var(--blocked);border-color:color-mix(in srgb,var(--blocked) 40%,var(--line))}
textarea{font:inherit;font-size:.9rem;width:100%;min-height:4.5rem;padding:.5rem .6rem;resize:vertical;
  border:1px solid var(--line);border-radius:.4rem;background:var(--bg);color:var(--fg)}
pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem;overflow-x:auto;
  margin:0;padding:.6rem .7rem;background:color-mix(in srgb,var(--fg) 4%,transparent);border-radius:.35rem;
  max-height:16rem;overflow-y:auto}
#toast{position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);background:var(--fg);color:var(--bg);
  padding:.5rem .9rem;border-radius:.4rem;font-size:.85rem;opacity:0;transition:opacity .2s;pointer-events:none;
  max-width:90vw}
#toast.on{opacity:1}
.ro{color:var(--muted);font-size:.82rem;font-style:italic}
table.att{width:100%;border-collapse:collapse;margin-top:.7rem;font-size:.82rem}
table.att td{padding:.25rem .5rem .25rem 0;border-bottom:1px solid var(--line);vertical-align:top}
table.att td:first-child{color:var(--muted);width:2.5rem;font-variant-numeric:tabular-nums}
button.link{border:none;background:none;padding:0;color:var(--progress);text-decoration:underline;
  font-size:.82rem;cursor:pointer}
button.link:hover{opacity:.75}
.pill.incomplete{background:var(--incomplete)}.pill.infra-failure{background:var(--infra)}
</style>
</head>
<body>
<main>
  <h1 id="run">connecting…</h1>
  <p class="sub" id="sub"></p>
  <div class="stats" id="stats"></div>
  <div id="pulse"></div>

  <h2>Milestones</h2>
  <div id="milestones"></div>

  <h2>Steering</h2>
  <div class="card">
    <textarea id="steerText" placeholder="A correction for every session launched from now on. It overrides the milestone prompt; it does not license dropping an acceptance criterion."></textarea>
    <div class="row" style="margin-top:.5rem">
      <button data-w onclick="steer(false)">Set</button>
      <button data-w onclick="steer(true)">Append</button>
      <button data-w onclick="post('/api/steer',{clear:true})">Clear</button>
      <span class="meta" id="steerNow"></span>
    </div>
  </div>

  <div class="card" id="logView" style="display:none">
    <div class="row"><strong>Transcript</strong><span class="meta" id="logName"></span>
      <button style="margin-left:auto" onclick="closeLog()">Close</button></div>
    <pre id="logBody" style="max-height:26rem"></pre>
  </div>

  <h2>Engine events</h2>
  <div class="card"><pre id="runLog"></pre></div>

  <h2>Interventions</h2>
  <div class="card"><pre id="supLog"></pre></div>

  <p class="sub" style="margin-top:1.5rem">
    <a id="reportLink" href="#">Open the full report</a>
  </p>
</main>
<div id="toast"></div>
<script>
const TOKEN = new URLSearchParams(location.search).get("token") || "";
const auth = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };
let writable = false;

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3200);
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
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const dur = (s) => s == null ? "-" : s < 60 ? s + "s" : s < 3600 ? Math.floor(s/60) + "m " + (s%60) + "s" : Math.floor(s/3600) + "h " + Math.floor(s%3600/60) + "m";

function render(d) {
  writable = d.writable;
  document.getElementById("run").textContent = d.run;
  document.getElementById("sub").textContent =
    d.done + "/" + d.total + " done" + (d.blocked ? ", " + d.blocked + " blocked" : "") + (d.runComplete ? " · run complete" : "");
  document.getElementById("reportLink").href = "/api/report?token=" + encodeURIComponent(TOKEN);

  const sessions = d.milestones.reduce((n, m) => n + m.history.length, 0);
  const infra = d.milestones.reduce((n, m) => n + m.history.filter(h => h.outcome === "infra-failure").length, 0);
  document.getElementById("stats").innerHTML = [
    ["milestones", d.done + "/" + d.total], ["sessions", sessions], ["infrastructure retries", infra],
    ["evidence lines", d.milestones.reduce((n, m) => n + m.evidence.length, 0)],
  ].map(([k, v]) => '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + "</div></div>").join("");

  const p = d.pulse;
  const live = d.liveness ? " · " + esc(d.liveness.path) + " touched " + dur(d.liveness.ageSeconds) + " ago" : "";
  document.getElementById("pulse").innerHTML =
    '<div class="card"><div class="row">' +
    (p && p.runnerAlive
      ? '<span class="pill alive">running</span><strong>' + esc(p.milestoneId || "-") + "</strong>" +
        '<span class="meta">attempt ' + esc(p.attempt) + " · " + esc(p.lastEvent) + " · session " + dur(p.sessionSeconds) +
        (p.agent ? " · agent " + esc(p.agent) : "") + live + "</span>" +
        (p.transcript ? '<button class="link" onclick="viewLog(' + JSON.stringify(p.transcript) + ')">live transcript</button>' : "")
      : d.runComplete
        ? '<span class="pill done">complete</span>'
        : '<span class="pill dead">no runner</span><span class="meta">nothing is driving this run' + live + "</span>") +
    '</div><div class="row" style="margin-top:.6rem">' +
    '<button data-w onclick="post(\'/api/run/start\')">Start run</button>' +
    '<button data-w onclick="post(\'/api/run/stop\')">Stop after this session</button>' +
    '<button data-w class="danger" onclick="killAgent()">Kill agent session</button>' +
    (d.attendConfigured ? '<button data-w onclick="post(\'/api/attend\',{})">Attend environment</button>' : "") +
    "</div></div>";

  document.getElementById("milestones").innerHTML = d.milestones.map(m => {
    const ev = m.evidence.length ? '<ul class="ev">' + m.evidence.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "";
    const dg = m.diagnosis
      ? '<div class="diag"><div><span class="k">symptom</span>' + esc(m.diagnosis.symptom) + "</div>" +
        (m.diagnosis.tried && m.diagnosis.tried.length ? '<div><span class="k">tried</span>' + esc(m.diagnosis.tried.join(" | ")) + "</div>" : "") +
        '<div><span class="k">user action</span><strong>' + esc(m.diagnosis.userAction) + "</strong></div></div>"
      : "";
    const un = m.status === "blocked"
      ? '<div class="row" style="margin-top:.6rem"><button data-w onclick="post(\'/api/unblock\',{id:' + JSON.stringify(m.id) + '})">Unblock</button>' +
        '<button data-w onclick="post(\'/api/unblock\',{id:' + JSON.stringify(m.id) + ',keepAttempts:true})">Unblock, keep attempts</button></div>'
      : "";
    const last = m.history[m.history.length - 1];
    const att = m.history.length
      ? '<table class="att"><tbody>' + m.history.map(h =>
          "<tr><td>#" + h.attempt + '</td><td><span class="pill ' + esc(h.outcome) + '">' + esc(h.outcome) + "</span></td>" +
          "<td>" + dur(h.seconds) + "</td><td>" + esc(h.agent || "") + "</td>" +
          '<td><button class="link" onclick="viewLog(' + JSON.stringify(h.transcript) + ')">transcript</button></td></tr>' +
          (h.detail ? '<tr><td></td><td colspan="4" class="meta">' + esc(h.detail) + "</td></tr>" : "") +
          (h.steering ? '<tr><td></td><td colspan="4" class="meta">steering: ' + esc(h.steering) + "</td></tr>" : "")
        ).join("") + "</tbody></table>"
      : "";
    return '<div class="card ' + esc(m.status) + '"><div class="row"><span class="pill ' + esc(m.status) + '">' +
      esc(m.status.replace("_", " ")) + '</span><strong>' + esc(m.id) + "</strong> " + esc(m.title) + "</div>" +
      '<p class="meta">' + m.history.length + " session" + (m.history.length === 1 ? "" : "s") + " · " +
      m.attempts + "/" + d.maxAttempts + " attempts charged" +
      (last && last.agent ? " · last agent " + esc(last.agent) : "") + "</p>" + dg + ev + att + un + "</div>";
  }).join("");

  document.getElementById("steerNow").textContent = d.steering ? "in force" : "none in force";
  document.getElementById("runLog").textContent = d.runLog.join("\n") || "nothing yet";
  document.getElementById("supLog").textContent = d.supervisorLog.join("\n") || "no interventions";

  document.querySelectorAll("[data-w]").forEach(b => { b.disabled = !writable; });
  if (!writable && !document.getElementById("roNote")) {
    const n = document.createElement("p");
    n.id = "roNote"; n.className = "ro";
    n.textContent = "Read-only panel. Restart with --write to enable the controls.";
    document.getElementById("sub").after(n);
  }
}
async function viewLog(name) {
  const box = document.getElementById("logView");
  const body = document.getElementById("logBody");
  document.getElementById("logName").textContent = name;
  body.textContent = "loading…";
  box.style.display = "block";
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await fetch("/api/transcript?token=" + encodeURIComponent(TOKEN) + "&name=" + encodeURIComponent(name), { headers: auth });
    body.textContent = r.ok ? await r.text() : "could not read it: " + (await r.json()).error;
    // A transcript is read to find out how it ended, so start at the end.
    body.scrollTop = body.scrollHeight;
  } catch (e) { body.textContent = "request failed: " + e.message; }
}
function closeLog() { document.getElementById("logView").style.display = "none"; }

function killAgent() {
  const reason = prompt("Why is this session being killed? It goes in the supervisor log.", "no progress");
  if (reason !== null) post("/api/kill", { reason: reason || "killed from the web panel" });
}

const es = new EventSource("/api/events?token=" + encodeURIComponent(TOKEN));
es.onmessage = (e) => render(JSON.parse(e.data));
es.onerror = () => { document.getElementById("sub").textContent = "connection lost, retrying…"; };
</script>
</body>
</html>`;
