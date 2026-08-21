<p align="center">
  <img src="https://raw.githubusercontent.com/fabrodz/milestoner/main/docs/assets/logo.jpg" alt="Milestoner" width="500">
</p>

<p align="center">
  <strong>An AI agent runner for software development, gated on evidence.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/milestoner"><img src="https://img.shields.io/npm/v/milestoner?color=cb3837&logo=npm" alt="npm"></a>
  <a href="https://github.com/fabrodz/milestoner/actions/workflows/ci.yml"><img src="https://github.com/fabrodz/milestoner/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/fabrodz/milestoner/releases"><img src="https://img.shields.io/github/v/release/fabrodz/milestoner" alt="Release"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/node/v/milestoner" alt="Node version">
</p>

# Milestoner

Supervised autonomous-run engine for coding agents. A milestone state machine that launches one
fresh headless agent session per milestone, grades what each session claims against written
evidence, and refuses to spend a retry on a usage limit.

The name is the thesis. A milestone only counts when something on disk proves it: a passing test, a
diff, a commit. Milestoner runs one fresh session per milestone, grades what that session claims
against the evidence it left behind, and moves the marker only when the two agree.

Status: **v0.6**. Engine, the active supervisor as an installable Claude Code skill and a Claude Code plugin, mid-flight steering, an HTML run report, a registry of the runs on your machine, and a web panel that comes up with the run.

## Install

Two install paths, and they are not alternatives: the CLI is the engine, the plugin is a Claude Code
layer on top of it.

**The CLI - required.** The `milestoner` binary is the engine: it runs a run, grades each session and
owns the state machine.

```sh
npm install -g milestoner
```

Or from source, which is what you want if you intend to change the engine:

```sh
git clone https://github.com/fabrodz/milestoner.git
cd milestoner && npm install && npm run build && npm link
```

Requires Node 20+ and an agent CLI on PATH (Claude Code by default).

**The plugin - optional.** A Claude Code plugin that adds the supervisor skill and four slash commands
(`/milestoner-init`, `/milestoner-status`, `/milestoner-supervise`, `/milestoner-report`) inside a Claude
session:

```sh
claude plugin marketplace add fabrodz/milestoner
claude plugin install milestoner@milestoner
```

**The plugin does not put the `milestoner` binary on your PATH.** Its slash commands and its supervisor
skill all shell out to that binary, so the plugin needs the CLI install above to do anything; it is a
convenience surface over the engine, not a second copy of it. A first-time user should do the CLI
install and add the plugin only to drive and supervise the run from inside Claude Code rather than a
terminal.

Runs on Windows, macOS and Linux; CI exercises all three. Everything platform-specific is inside
the engine: killing a session and everything it spawned (`taskkill /T` or the session's own POSIX
process group), opening the report (`start`, `open` or `xdg-open`), and launching through an npm
`.cmd` shim on Windows with the quoting `cmd.exe` needs.
The one thing you supply per platform is the environment adapter, because unsticking a host is
inherently host-shaped; examples for both families ship in
[examples/adapters/](examples/adapters/).

## What you are agreeing to

milestoner exists to run a coding agent for hours while you are not watching, so the default
`agent.args` include `--dangerously-skip-permissions`. A headless session cannot answer a permission
prompt; without that flag it hangs until the timeout instead of working.

The consequence is real and worth stating plainly: **for as long as the run lasts, the agent can
read, write and delete anything your user account can, and run any command, unattended.** The engine
does not sandbox it and cannot review what it does.

Before leaving a run overnight:

- Run it in a project directory you would be willing to restore from git.
- Commit or push first. The protocol template tags every green milestone, which is what makes
  `git reset --hard <tag>` a real rollback.
- Prefer a VM, container or dedicated user account when the project is not yours.
- Consider removing `--dangerously-skip-permissions` and supplying a narrower allowlist through your
  agent's own settings. The engine passes `agent.args` through verbatim, so this is a config change.

## Use

```sh
milestoner init --run my-run --milestones 5
# write .milestoner/protocol.md and the milestone prompts, then:
milestoner run
milestoner status
```

### Commands

| Command | What it does |
| --- | --- |
| `milestoner init [--run <name>] [--milestones <n>] [--force]` | Scaffold `.milestoner/`: config, state machine, protocol template, prompt skeletons. |
| `milestoner run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once] [--serve]` | Drain the run: one fresh agent session per milestone until complete or blocked. `--serve` brings the web panel up with it. |
| `milestoner status [--json]` | Milestones, attempts, evidence counts, and the pulse. |
| `milestoner runs [--json]` | Every run registered on this machine, from anywhere: project, milestone, progress, liveness. |
| `milestoner unblock <id> [--keep-attempts]` | Clear a block after fixing it; sets the milestone back to pending. |
| `milestoner steer ["<text>"] [--append] [--clear]` | Course-correct a run in flight; applies to the next session launched. |
| `milestoner report [--out <path>] [--open]` | Write a single self-contained HTML report of the run. |
| `milestoner serve [--port <n>] [--write]` | Local web panel for the run. Loopback only, key in the URL. |
| `milestoner skill install [--global] [--force] [--print]` | Install the supervisor skill into `.claude/skills/`. |
| `milestoner kill [--reason <text>] [--rule <n>]` | Supervisor intervention: kill the hung agent session. Never the runner. |
| `milestoner attend [--seconds <n>] [--rule <n>]` | Supervisor intervention: run the configured environment adapter. |

Exit codes: `0` ok, `1` error, `2` blocked - and for `runs`, `2` also when a listed run's runner is
gone, which is the same "this needs you" signal.

`runs` is the only command that does not need a project. `status` answers for the directory you are
in; `runs` answers for the machine, reading a registry at `~/.milestoner/runs.json` that every runner
adds itself to on start and removes itself from on exit. A runner that was killed never gets to
remove its entry, so it stays, reported `gone`, for a day. That is the point: a run that died
overnight is the one worth being told about.

## How a run works

<p align="center">
  <img src="https://raw.githubusercontent.com/fabrodz/milestoner/main/docs/assets/run-loop.svg" alt="The milestoner run loop: the engine launches one fresh agent session per milestone, the session writes result.json, the engine grades it into done, incomplete or blocked, while the supervisor watches" width="900">
</p>

1. **Fresh session per milestone.** Clean context every time. State lives in files, never in the
   conversation.
2. **The engine owns `state.json`.** The session writes one small drop box, `.milestoner/result.json`,
   with its status, its evidence lines and, when blocked, its diagnosis. The engine grades that,
   merges it, and archives the raw claim under `.milestoner/results/`.
3. **Evidence is a gate.** `done` with no evidence line per acceptance criterion is downgraded to
   incomplete and retried. The verdict never comes from the exit code.
4. **`blocked` needs a diagnosis**: exact symptom, everything tried, the single clearest user
   action. Blocked is a handoff with an address, not a failure.
5. **Infrastructure is not failure.** A session that dies in seconds with a tiny transcript, hits a
   usage limit, or crashes at any point leaving a next-to-empty transcript, does not consume an
   attempt. An announced reset time is parsed and waited out.
6. **Liveness comes from side signals.** Watched source dirs, test-result files and tool logs, never
   the transcript: a headless `claude -p` flushes it only at exit.

## The supervisor

The engine keeps a run correct. The supervisor keeps it *alive*: a Claude session that wakes every
ten minutes, decides whether the run is advancing, and intervenes inside a bounded playbook.

```sh
milestoner skill install     # not needed if you installed the plugin
```

Then, in a Claude Code session at the project root:

```
/loop 10m Use the milestoner-supervisor skill to perform one supervision cycle.
```

Each cycle it reads the whole run through `milestoner status --json` and applies the first matching
rule: healthy, environment stalled, agent session hung, waiting out a usage limit, runner dead,
blocked for real, or something it cannot explain. Its entire write surface is `milestoner kill`,
`milestoner attend`, relaunching `milestoner run`, and appending to `.milestoner/supervisor-log.md`.
It never edits project code, never touches `state.json`, and never runs the project's own tools
while a session owns them. Clearing a block stays a human decision.

`milestoner kill` targets the agent session, not the runner: the runner sees the session end, grades
it incomplete, consumes an attempt and relaunches with fresh context. The kill is recorded so it
cannot be mistaken for an infrastructure death and silently refunded.

**Environment adapter.** Some environments get stuck in ways no agent can fix from inside its own
session: a GUI editor loses focus, a native modal blocks the main thread, a dev server wedges, a
connected device drops off the bus. Playbook rule 3 runs `environment.attendCommand` against exactly
that, and nothing else. The engine knows nothing about any of them; the adapter is one command line
you write, and a headless project leaves it null so the rule cannot fire. Two examples ship in
[examples/adapters/](examples/adapters/).

The full playbook, rule by rule, is in [docs/GUIDE.md](docs/GUIDE.md#the-supervisor).

## Steering a run in flight

You do not have to kill a run to correct it. `milestoner steer` writes `.milestoner/STEERING.md`, and
every session launched from that point on gets the text inlined into its kickoff as an override on
the milestone prompt:

```sh
milestoner steer "prefer the simpler fix over the general one"
milestoner steer --append "do not touch the public API"
milestoner steer            # show what is in force
milestoner steer --clear    # back to the milestone prompts alone
```

It persists until you clear it, and every attempt records the steering that was in force, so it is
always visible which sessions saw it. It overrides the prompt; it does not license dropping an
acceptance criterion. A steer that makes a milestone impossible comes back as `blocked`.

The supervisor cannot steer. If it thinks a run needs correcting, it proposes the wording and you
decide.

## The web panel

```sh
milestoner run --serve      # the panel comes up with the run and closes when it ends
milestoner serve --write    # the panel on its own, against whatever is or is not running
```

Both print a URL carrying a one-time key. The panel shows the same run `status` does, refreshed over
server-sent events, and lets you act on it: set or clear steering, unblock a milestone, kill a hung
session, run the environment adapter, start a runner or stop it. It is deliberately the *same*
surface as the CLI, calling the same functions, which is what keeps one audit trail rather than two.

The use it earns its keep for is the one the CLI is worst at: it is 3am, the run is on milestone
four, and you want to read the diagnosis and the last transcript and steer from your phone without
finding a laptop.

**Read what this is before you run it.** Everything the panel can do, it does with your account's
permissions on the machine it runs on: starting a run launches an agent with
`--dangerously-skip-permissions`, and `attend` runs your `attendCommand` through a shell. A
write-enabled panel is a remote code execution endpoint by construction. It binds `127.0.0.1` only
and that is not configurable, every request needs the key from the URL, non-loopback `Host` headers
and cross-origin writes are refused, and without `--write` every mutating route answers 403.
**Treat the URL like a password: it is one.** There is no `--open` for this reason - handing that URL
to a browser writes a live credential into its history.

To reach it from another device, forward the port over SSH rather than exposing it. That recipe, the
full security model and the differences between `--serve` and `serve` are in
[docs/GUIDE.md](docs/GUIDE.md#milestoner-serve), with the reasoning in
[D-027](docs/DECISIONS.md#d-027---the-panel-comes-up-with-the-run-and-what-that-costs-2026-08-20).

## The run report

```sh
milestoner report --open
```

One self-contained HTML file: stat tiles, a wall-clock timeline of every session that ran, a card
per milestone with its evidence and diagnosis, the attempt table, and the interventions. No
scripts, no external assets, so it opens offline and survives being sent to someone.

The timeline is the part `status` cannot give you: the gaps are as informative as the bars. A
usage-limit wait looks different from a slow session, and the infrastructure retries that were
never charged against the attempt budget are visible after the fact.

## Layout

```
.milestoner/
  config.json          agent command, attempts, infra rules, liveness watch list
  state.json           the state machine (engine-owned)
  protocol.md          shared rules every session reads first
  prompts/M01.md       hand-written milestone specs: objective, tasks, gates, exit
  results/             archived per-attempt claims
  logs/                session transcripts
  STEERING.md          your mid-flight corrections (absent = none)
  report.html          generated run report
  run-log.md           append-only engine events
  supervisor-log.md    append-only interventions
  execution-log.md     the agent's own narrative log
  decisions.md         autonomous decisions the agent made

~/.milestoner/
  runs.json            machine-level registry of runs, read by `milestoner runs`
```

## Configuration

`.milestoner/config.json`, written by `init` and edited by you:

```json
{
  "run": "my-run",
  "maxAttempts": 3,
  "agent": { "command": "claude",
             "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"] },
  "liveness": ["src", "tests/results/latest.txt"],
  "environment": { "attendCommand": null, "attendSeconds": 120 }
}
```

`args` placeholders: `{{kickoff}}`, `{{promptFile}}`, `{{milestoneId}}`, `{{projectRoot}}`,
`{{milestonerDir}}`, `{{model}}`.

**Set `liveness`.** It is the list of paths whose mtime proves work is happening. Without it,
`status` can tell you a process exists but not that it is doing anything, which is the difference
between a run that is thinking and a run that is wedged.

Every key, including the `infra` block that decides what counts as an infrastructure failure rather
than a milestone failure, is documented in
[docs/GUIDE.md](docs/GUIDE.md#configuration-reference).

## Running a different agent

The agent is a command in `.milestoner/config.json`, not a dependency. `{{kickoff}}` is substituted
with the milestone prompt:

```json
"agent": { "name": "claude", "command": "claude",
           "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"] }
```

Claude Code and Codex are both exercised in this repository's own runs. Anything works that accepts
a prompt as an argument, can read and write files in the project, and exits when finished.

`fallbackAgents` covers the 2am usage limit: when a session fails for a reason the infra rules
recognise, the failing agent is benched until its announced reset and the next authenticated one
takes over immediately, without sleeping and without consuming the attempt. It never triggers on a
work failure, because an `incomplete` verdict is what the attempt budget is for.

Full recipes for Claude Code, Codex, a local model through Ollama and the fallback pool are in
[docs/GUIDE.md](docs/GUIDE.md#running-a-different-agent), including what a small local model
actually does when handed a milestone.

## Roadmap

- **v0.1** engine: `init`, `run`, `status`, `unblock`. Done.
- **v0.2** active supervisor as an installable Claude Code skill; intervention log; environment
  adapter as a config string. Done.
- **v0.3** single-file HTML run report; steering file support. Done.
- **v0.4** plugin packaging: manifest, the supervisor skill and four slash commands as plugin
  components, and an in-repo single-plugin marketplace. Done. A second agent behind the config
  string is done too: see [Running a different agent](#running-a-different-agent).
- **v0.5** the debt v0.4 exposed, plus one addition: a green test suite on Windows, `kill` ending
  the whole session on macOS and Linux rather than one process, a machine-level registry behind
  [`milestoner runs`](#commands), and the panel coming up with the run behind
  [`--serve`](#the-web-panel). Done.
- **v0.6** three bugs the v0.5 run found by running: a state lock that a contender could break in
  the instant after it was taken, a crashed session charged an attempt it did not deserve, and
  `init` handing a new run the previous run's protocol. First version published to npm. Done.

Validated end to end, by building itself. v0.4 was a four-milestone milestoner run and v0.5 to v0.6
was a seven-milestone one, every milestone a fresh Claude Code session graded against the evidence it
wrote. Nine of the eleven closed on the first attempt.

The more useful result is what the second run found by running. Three of its seven milestones were
not planned: they were bugs in the engine, hit by the engine while it executed. A session crashed
after fifteen minutes of finished work leaving a fifteen-byte transcript, and the classifier charged
it a real attempt because it only read a tiny transcript as a crash inside `infra.deathSeconds`
(D-029). A state lock could be broken by a contender in the instant after it was taken, losing an
update (D-028). `init` handed a new run the previous run's protocol, so five sessions read rules
naming a finished run and nothing said so (D-030). Each became a milestone of the run that exposed
it.

The runs' own state and evidence are not in the tree, because a run's record belongs to the machine
that ran it. They are in this repository's git history up to v0.6.0 if you want to read what those
sessions actually wrote.

What neither run exercised: a run long enough to hit a real usage limit or agent fallback mid-flight,
a non-Claude agent across a whole run rather than a single milestone, and the supervisor loop against
a live multi-milestone run rather than the one blocked run it has been tried on.

## Changelog

[CHANGELOG.md](CHANGELOG.md).

## Documentation

[docs/GUIDE.md](docs/GUIDE.md) is the user guide: the mental model, a full walkthrough, command and
config reference, grading and infra rules, use cases, recipes and troubleshooting.
[docs/NEXT.md](docs/NEXT.md) is what is left to do and in what order.

## Background

This grew out of two real overnight runs on a private Unity 6 project, driven by a PowerShell
orchestrator. That script is not in the tree: every rule it carried now lives in `src/` with tests,
and keeping the ancestor beside the engine only invited the question of which one to run.

[docs/DECISIONS.md](docs/DECISIONS.md) records every product decision, what was rejected and why,
including the ones taken before the first line of TypeScript.

## Development

```sh
npm install
npm test         # rule-level tests: infra classification, grading, state migration, quoting,
                 # config merging, exit codes, the report, and the supervisor playbook's shape
npm run typecheck
npm run build
```

CI runs all three on Node 20, 22 and 24 on Linux, and on the ends of that range on macOS and
Windows. The working tree is pinned to LF by `.gitattributes`, because several tests compare bytes
read from disk and a CRLF checkout fails them.

## License

MIT. See [LICENSE](LICENSE).
