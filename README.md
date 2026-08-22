<p align="center">
  <img src="https://raw.githubusercontent.com/fabrodz/milestoner/main/docs/assets/logo.jpg" alt="Milestoner" width="500">
</p>

<p align="center">
  <strong>Run massive plans unattended for hours, gated on evidence.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/milestoner"><img src="https://img.shields.io/npm/v/milestoner?color=cb3837&logo=npm" alt="npm"></a>
  <a href="https://github.com/fabrodz/milestoner/actions/workflows/ci.yml"><img src="https://github.com/fabrodz/milestoner/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/fabrodz/milestoner/releases"><img src="https://img.shields.io/github/v/release/fabrodz/milestoner" alt="Release"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/node/v/milestoner" alt="Node version">
</p>

Supervised autonomous-run engine for coding agents. A milestone state machine that launches one
fresh headless agent session per milestone, grades what each session claims against written
evidence, and refuses to spend a retry on a usage limit.

A milestone only counts when something on disk proves it: a passing test, a diff, a commit. The
marker moves only when the session's claim and the evidence it left behind agree.

milestoner does not remove your work; it moves it. The hours of execution go to the agent, but the
design, the decomposition and the acceptance criteria are yours, written before the run starts. It
is a verification engine with an executor inside, not the other way around.

## Install

The `milestoner` binary is the engine: it runs a run, grades each session and owns the state machine.

```sh
npm install -g milestoner
```

Or from source, which is what you want if you intend to change the engine:

```sh
git clone https://github.com/fabrodz/milestoner.git
cd milestoner && npm install && npm run build && npm link
```

Requires Node 20+ and an agent CLI on PATH (Claude Code by default).

The supervisor and planner skills for Claude Code ship inside the package; `milestoner skill
install` writes them into `.claude/skills/` (`-g` for `~/.claude/skills/`). There is no separate
plugin or marketplace install: the skills shell out to the `milestoner` binary, so distributing
them apart from it would install something with nothing to call.

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

First time here? [The guide's quickstart](docs/GUIDE.md#quickstart-your-first-run) walks the whole
first run - scaffold, plan, run, supervise, report - assuming nothing. The short version:

```sh
milestoner init --run my-run --milestones 5
# write .milestoner/protocol.md and the milestone prompts, then:
milestoner run
milestoner status
```

The protocol and the milestone prompts are yours to author; that friction is deliberate (the
evidence gate only means something when a person wrote the criteria). If you do not know where to
start, the planner skill walks a Claude session through it with you: it interviews you, proposes a
milestone breakdown for your approval, and only then writes the prompts, the protocol TODOs and the
liveness config. Nothing is generated without your sign-off. That lowers the bar from authoring to
reviewing, not to zero: you still need to tell a verifiable acceptance criterion from a vague one,
because a bad plan approved makes the gate theatre.

```sh
milestoner skill install planner
```

Then, in a Claude Code session at the project root:
"Use the milestoner-planner skill to plan this run."

### Commands

| Command | What it does |
| --- | --- |
| `milestoner init [--run <name>] [--milestones <n>] [--force]` | Scaffold `.milestoner/`: config, state machine, protocol template, prompt skeletons. |
| `milestoner lint [--json]` | Check the run's form before a session spends time on it: prompts, protocol, config. Errors exit `1`; warnings alone stay `0`. |
| `milestoner run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once] [--no-lint] [--no-panel] [--open \| --no-open] [--serve]` | Drain the run: one fresh agent session per milestone until complete or blocked. Lints first and refuses to start on error-level findings on pending milestones; `--no-lint` overrides. Brings the machine panel up by default; `--serve` attaches a per-run panel instead. |
| `milestoner status [--json]` | Milestones, attempts, evidence counts, and the pulse. |
| `milestoner runs [--json]` | Every run registered on this machine, from anywhere: project, milestone, progress, liveness. |
| `milestoner unblock <id> [--keep-attempts]` | Clear a block after fixing it; sets the milestone back to pending. |
| `milestoner steer ["<text>"] [--append] [--clear]` | Course-correct a run in flight; applies to the next session launched. |
| `milestoner report [--out <path>] [--open]` | Write a single self-contained HTML report of the run. |
| `milestoner serve [--all] [--port <n>] [--write]` | Local web panel. Loopback only, key in the URL. `--all` serves every run on the machine, from any directory. |
| `milestoner skill install [<name>] [-g\|--global] [--force] [--print]` | Install the bundled skills (supervisor, planner) into `.claude/skills/`; name one to install just it. |
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
milestoner skill install supervisor
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
session: a GUI editor loses focus, a native modal blocks the main thread, a connected device drops
off the bus. Playbook rule 3 runs `environment.attendCommand` against exactly that, and nothing
else; the adapter is one command line you write, and a headless project leaves it null so the rule
cannot fire. Two examples ship in [examples/adapters/](examples/adapters/).

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
milestoner run              # the machine panel comes up with the first run and spans every run
milestoner serve --all      # the same machine panel, by hand, from any directory
milestoner run --serve      # a panel pinned to this run only, closed when the run ends
milestoner serve --write    # the per-project panel on its own, against whatever is or is not running
```

Every form prints a URL carrying a one-time key. The panel shows the same run `status` does,
refreshed over server-sent events, and lets you act on it: scaffold a new run in a directory, set or
clear steering, unblock a milestone, kill a hung session, run the environment adapter, start a runner
or stop it. It is
deliberately the *same* surface as the CLI, calling the same functions, which is what keeps one
audit trail rather than two. The machine panel runs as a detached daemon the first run starts,
lists every run on the machine with a switcher between them, and exits on its own ten minutes
after the last run ends
([D-033](docs/DECISIONS.md#d-033---the-panel-spans-runs-one-machine-panel-brought-up-by-the-first-run-2026-08-20)).
It lists more than the live ones: the CLI records every project it works in to
`~/.milestoner/projects.json`, so a project whose run is finished, or never started, is there to be
opened and started after a reboot
([D-037](docs/DECISIONS.md#d-037---a-projects-file-so-the-panel-knows-a-project-no-runner-is-announcing-2026-08-22)).
The hub also scaffolds: a directory path, a run name and a milestone count call the same `init()`
the CLI does, with the same refusals, and the new project joins the listing on the next refresh
([D-038](docs/DECISIONS.md#d-038---the-panel-scaffolds-a-project-by-path-and-why-that-is-not-a-new-hole-2026-08-22)).

**Read what this is before you run it.** Everything the panel can do, it does with your account's
permissions on the machine it runs on: starting a run launches an agent with
`--dangerously-skip-permissions`, and `attend` runs your `attendCommand` through a shell. A
write-enabled panel is a remote code execution endpoint by construction - and the machine panel a
run starts is write-enabled, because kill, steer and unblock at 3am are why it exists. It binds
`127.0.0.1` only and that is not configurable, every request needs the key from the URL, and
non-loopback `Host` headers and cross-origin writes are refused.
**Treat the URL like a password: it is one.** Never paste it anywhere that syncs.

To reach it from another device, forward the port over SSH rather than exposing it. That recipe, the
full security model and the differences between the panel forms are in
[docs/GUIDE.md](docs/GUIDE.md#milestoner-serve), with the reasoning in
[D-027](docs/DECISIONS.md#d-027---the-panel-comes-up-with-the-run-and-what-that-costs-2026-08-20) and
[D-033](docs/DECISIONS.md#d-033---the-panel-spans-runs-one-machine-panel-brought-up-by-the-first-run-2026-08-20).

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

**Set `liveness`.** It is the list of paths whose mtime proves work is happening. Without it,
`status` can tell you a process exists but not that it is doing anything, which is the difference
between a run that is thinking and a run that is wedged.

Every key, including the `infra` block that decides what counts as an infrastructure failure rather
than a milestone failure, is documented in
[docs/GUIDE.md](docs/GUIDE.md#configuration-reference); what every file under `.milestoner/` is
for is in [the guide's layout section](docs/GUIDE.md#the-milestoner-directory).

## Running a different agent

The agent is a command in `.milestoner/config.json`, not a dependency. `{{kickoff}}` is substituted
with the milestone prompt:

```json
"agent": { "name": "claude", "command": "claude",
           "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"] }
```

Anything works that accepts a prompt as an argument, can read and write files in the project, and
exits when finished; Claude Code and Codex are both exercised in this repository's own runs.
`fallbackAgents` covers the 2am usage limit: when a session fails for a reason the infra rules
recognise, the failing agent is benched until its announced reset and the next authenticated one
takes over, without sleeping and without consuming the attempt. Full recipes - Claude Code, Codex,
a local model through Ollama, the fallback pool - are in
[docs/GUIDE.md](docs/GUIDE.md#running-a-different-agent).

## Roadmap

- **v0.1** engine: `init`, `run`, `status`, `unblock`. Done.
- **v0.2** active supervisor as an installable Claude Code skill; intervention log; environment
  adapter as a config string. Done.
- **v0.3** single-file HTML run report; steering file support. Done.
- **v0.4** plugin packaging: manifest, the supervisor skill and four slash commands as plugin
  components, and an in-repo single-plugin marketplace. Done, and retired in v0.7: a plugin that
  cannot work without the npm install is not a second channel, it is a second copy of the first
  one (D-034). A second agent behind the config string is done too: see
  [Running a different agent](#running-a-different-agent).
- **v0.5** the debt v0.4 exposed, plus one addition: a green test suite on Windows, `kill` ending
  the whole session on macOS and Linux rather than one process, a machine-level registry behind
  [`milestoner runs`](#commands), and the panel coming up with the run behind
  [`--serve`](#the-web-panel). Done.
- **v0.6** three bugs the v0.5 run found by running: a state lock that a contender could break in
  the instant after it was taken, a crashed session charged an attempt it did not deserve, and
  `init` handing a new run the previous run's protocol. First version published to npm. Done.
- **v0.7** the planner skill, the machine panel (one panel spanning every run, brought up by the
  first one), one distribution channel (the plugin retired, D-034), and `skill install -g`. Done.

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
