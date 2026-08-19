# DogWatch

Supervised autonomous-run engine for coding agents. A milestone state machine that launches one
fresh headless agent session per milestone, grades what each session claims against written
evidence, and refuses to spend a retry on a usage limit.

The name is the thesis. The dog watch is the night shift at sea: the one nobody wants and every
crew needs. That is the differentiator, knowing a long run is still alive at four in the morning and
acting when it isn't.

Status: **v0.3**. Engine, the active supervisor as an installable Claude Code skill, mid-flight steering, and an HTML run report.

## Install

Not on npm yet. Install from source:

```sh
git clone https://github.com/fabrodz/dogwatch.git
cd dogwatch && npm install && npm run build && npm link
```

Requires Node 20+ and an agent CLI on PATH (Claude Code by default).

Runs on Windows, macOS and Linux; CI exercises all three. Everything platform-specific is inside
the engine: killing a session (`taskkill` or `SIGTERM`), opening the report (`start`, `open` or
`xdg-open`), and launching through an npm `.cmd` shim on Windows with the quoting `cmd.exe` needs.
The one thing you supply per platform is the environment adapter, because unsticking a host is
inherently host-shaped; examples for both families ship in
[examples/adapters/](examples/adapters/).

## What you are agreeing to

dogwatch exists to run a coding agent for hours while you are not watching, so the default
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
dogwatch init --run my-run --milestones 5
# write .dogwatch/protocol.md and the milestone prompts, then:
dogwatch run
dogwatch status
```

### Commands

| Command | What it does |
| --- | --- |
| `dogwatch init [--run <name>] [--milestones <n>] [--force]` | Scaffold `.dogwatch/`: config, state machine, protocol template, prompt skeletons. |
| `dogwatch run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]` | Drain the run: one fresh agent session per milestone until complete or blocked. |
| `dogwatch status [--json]` | Milestones, attempts, evidence counts, and the pulse. |
| `dogwatch unblock <id> [--keep-attempts]` | Clear a block after fixing it; sets the milestone back to pending. |
| `dogwatch steer ["<text>"] [--append] [--clear]` | Course-correct a run in flight; applies to the next session launched. |
| `dogwatch report [--out <path>] [--open]` | Write a single self-contained HTML report of the run. |
| `dogwatch skill install [--global] [--force] [--print]` | Install the supervisor skill into `.claude/skills/`. |
| `dogwatch kill [--reason <text>] [--rule <n>]` | Supervisor intervention: kill the hung agent session. Never the runner. |
| `dogwatch attend [--seconds <n>] [--rule <n>]` | Supervisor intervention: run the configured environment adapter. |

Exit codes: `0` ok, `1` error, `2` blocked.

## How a run works

```
init  ->  hand-write prompts  ->  run  ->  [session per milestone]  ->  complete | blocked
                                            |
                                            +-- writes .dogwatch/result.json, engine grades it
```

1. **Fresh session per milestone.** Clean context every time. State lives in files, never in the
   conversation.
2. **The engine owns `state.json`.** The session writes one small drop box, `.dogwatch/result.json`,
   with its status, its evidence lines and, when blocked, its diagnosis. The engine grades that,
   merges it, and archives the raw claim under `.dogwatch/results/`.
3. **Evidence is a gate.** `done` with no evidence line per acceptance criterion is downgraded to
   incomplete and retried. The verdict never comes from the exit code.
4. **`blocked` needs a diagnosis**: exact symptom, everything tried, the single clearest user
   action. Blocked is a handoff with an address, not a failure.
5. **Infrastructure is not failure.** A session that dies in seconds with a tiny transcript, or hits
   a usage limit, does not consume an attempt. An announced reset time is parsed and waited out.
6. **Liveness comes from side signals.** Watched source dirs, test-result files and tool logs, never
   the transcript: a headless `claude -p` flushes it only at exit.

## The supervisor

The engine keeps a run correct. The supervisor keeps it *alive*: a Claude session that wakes every
ten minutes, decides whether the run is advancing, and intervenes inside a bounded playbook.

```sh
dogwatch skill install
```

Then, in a Claude Code session at the project root:

```
/loop 10m Use the dogwatch-supervisor skill to perform one supervision cycle.
```

Each cycle it reads the whole run through `dogwatch status --json` and applies the first matching
rule: healthy, environment stalled, agent session hung, waiting out a usage limit, runner dead,
blocked for real, or something it cannot explain. Its entire write surface is `dogwatch kill`,
`dogwatch attend`, relaunching `dogwatch run`, and appending to `.dogwatch/supervisor-log.md`. It
never edits project code, never touches `state.json`, and never runs the project's own tools while
a session owns them. Clearing a block stays a human decision.

`dogwatch kill` targets the agent session, not the runner: the runner sees the session end, grades
it as incomplete, consumes an attempt and relaunches with a fresh context. The kill is recorded so
it cannot be mistaken for an infrastructure death and silently refunded.

**Environment adapter.** Some environments get stuck in ways no agent can fix from inside its own
session: a GUI editor loses focus and stops ticking, a native modal blocks the main thread, a
language server or dev server wedges, a connected device drops off the bus. Playbook rule 3 runs
`environment.attendCommand` against exactly that, and nothing else.

The engine knows nothing about any of these; the adapter is one command line you write. Two
examples ship in [examples/adapters/](examples/adapters/), one per platform family, along with the
four obligations any adapter has. A headless project leaves the command null and the rule simply
cannot fire.

```json
"environment": {
  "attendCommand": "powershell -ExecutionPolicy Bypass -File .dogwatch/adapters/unity-attend.ps1 -Seconds {{seconds}}",
  "attendSeconds": 120
}
```

## Steering a run in flight

You do not have to kill a run to correct it. `dogwatch steer` writes `.dogwatch/STEERING.md`, and
every session launched from that point on gets the text inlined into its kickoff as an override on
the milestone prompt:

```sh
dogwatch steer "prefer the simpler fix over the general one"
dogwatch steer --append "do not touch the public API"
dogwatch steer            # show what is in force
dogwatch steer --clear    # back to the milestone prompts alone
```

It persists until you clear it, and every attempt records the steering that was in force, so it is
always visible which sessions saw it. It overrides the prompt; it does not license dropping an
acceptance criterion. A steer that makes a milestone impossible comes back as `blocked`.

The supervisor cannot steer. If it thinks a run needs correcting, it proposes the wording and you
decide.

## The run report

```sh
dogwatch report --open
```

One self-contained HTML file: stat tiles, a wall-clock timeline of every session that ran, a card
per milestone with its evidence and diagnosis, the attempt table, and the interventions. No
scripts, no external assets, so it opens offline and survives being sent to someone.

The timeline is the part `status` cannot give you: the gaps are as informative as the bars. A
usage-limit wait looks different from a slow session, and the infrastructure retries that were
never charged against the attempt budget are visible after the fact.

## Layout

```
.dogwatch/
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
```

## Configuration

```json
{
  "run": "my-run",
  "maxAttempts": 3,
  "retryDelaySeconds": 15,
  "agent": {
    "command": "claude",
    "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"],
    "modelArgs": ["--model", "{{model}}"],
    "model": null,
    "env": {}
  },
  "infra": {
    "deathSeconds": 90,
    "tinyTranscriptBytes": 500,
    "maxRetries": 30,
    "usageLimitWaitSeconds": 600,
    "genericWaitSeconds": 60,
    "usageLimitPatterns": ["session limit", "usage limit", "rate limit", "429"],
    "infraFailurePatterns": ["stream disconnected", "connection refused", "econnrefused",
                             "authentication failed", "not logged in"]
  },
  "liveness": ["src", "tests/results/latest.txt"],
  "environment": { "attendCommand": null, "attendSeconds": 120 }
}
```

`args` placeholders: `{{kickoff}}`, `{{promptFile}}`, `{{milestoneId}}`, `{{projectRoot}}`,
`{{dogwatchDir}}`, `{{model}}`. A different agent is a config change, not an engine change.

`liveness` is the list of paths whose mtime proves work is happening. Set it: without it `status`
can tell you a process exists, but not that it is doing anything.

## Running a different agent

The agent is a command line, so a second agent is a config change. Claude Code is the default and
the one exercised most; the recipes below were run against this engine.

**OpenAI Codex** (`codex exec`, verified against codex-cli 0.133.0):

```json
"agent": {
  "command": "codex",
  "args": ["exec", "{{kickoff}}", "--dangerously-bypass-approvals-and-sandbox",
           "--skip-git-repo-check", "-C", "{{projectRoot}}"],
  "modelArgs": ["--model", "{{model}}"],
  "model": null,
  "env": {}
}
```

Codex needs `-C` because it does not inherit the working directory the way `claude -p` does, and
`--skip-git-repo-check` only if the project is not a git repository. Its usage-limit message is
caught by the stock `infra.usageLimitPatterns`: a session that hit an OpenAI quota was refunded and
waited, with no engine change.

**A local model through Ollama.** Ollama is a model server, not an agent: it has no tools and cannot
read or write a file, so it cannot execute a milestone on its own. Drive it through an agentic CLI.
With Codex, that is two extra arguments:

```json
"args": ["exec", "{{kickoff}}", "--dangerously-bypass-approvals-and-sandbox",
         "-C", "{{projectRoot}}", "--oss", "--local-provider", "ollama"],
"model": "qwen2.5-coder:7b"
```

`ollama serve` has to be running. Expect this to be the weakest link by far: a 7B model given this
protocol invented a script it never wrote, printed its verdict to stdout instead of writing
`result.json`, and claimed `done`. The engine graded it `incomplete` and retried, which is the point
of the evidence gate, but no amount of grading turns a small model into a milestone executor.

### Falling back to a second agent

A run that hits a usage limit at 2am with a reset at 5am sleeps three hours. If another agent is
authenticated, it does not have to:

```json
"agent": { "name": "claude", "command": "claude", "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"] },
"fallbackAgents": [
  { "name": "codex", "command": "codex",
    "args": ["exec", "{{kickoff}}", "--dangerously-bypass-approvals-and-sandbox", "-C", "{{projectRoot}}"] }
]
```

When a session fails for a reason the infra rules recognise, the failing agent is benched and the
next free one takes over **immediately, without sleeping**. The attempt is still not consumed. Only
when every agent is cooling down does the runner wait, and then only for the shortest of them.

The bench is a cooldown, not a demotion: a usage limit benches the agent until its announced reset,
so the primary comes back the moment its quota does rather than being written off for the rest of
the run.

It never triggers on a work failure. An `incomplete` verdict means the milestone was not finished,
which is what the attempt budget is for; swapping the agent there would quietly turn a quality
problem into a different agent's problem.

**The risk is silent degradation**, so the rotation is recorded everywhere it can be read back: the
agent that ran each attempt is in `state.json`, in the attempt table of the report, in `run-log.md`,
and in `status --json` while the run is live. Absent `fallbackAgents`, none of this changes: a pool
of one benches its only agent and waits, exactly as before.

**Anything else.** The engine only needs a command that (a) accepts a prompt as an argument or in
`args`, (b) can read and write files in the project, and (c) exits when it is finished. If the
agent announces its own failures in prose rather than dying instantly, add its wording to
`infra.infraFailurePatterns` so those failures are refunded instead of charged.

## Roadmap

- **v0.1** engine: `init`, `run`, `status`, `unblock`. Done.
- **v0.2** active supervisor as an installable Claude Code skill; intervention log; environment
  adapter as a config string. Done.
- **v0.3** single-file HTML run report; steering file support. Done.
- **v0.4** plugin packaging. A second agent behind the config string is done: see
  [Running a different agent](#running-a-different-agent).

Not yet validated: a full multi-milestone run driven by a real agent end to end. Everything above is
exercised by unit tests and by scripted agents, plus one real supervision cycle against a blocked
run, and single milestones driven by Claude Code and by Codex.

## Changelog

[CHANGELOG.md](CHANGELOG.md).

## Documentation

[docs/GUIDE.md](docs/GUIDE.md) is the user guide: the mental model, a full walkthrough, command and
config reference, grading and infra rules, use cases, recipes and troubleshooting.

## Background

[BRIEF.md](BRIEF.md) is the genesis document: where this comes from (two real overnight runs on a
Unity 6 game), what made those runs work, and the competitive landscape.
[docs/DECISIONS.md](docs/DECISIONS.md) records the product decisions and what was rejected.
The PowerShell orchestrator these runs grew from is not in the tree: every rule it carried now
lives in `src/` with tests, and keeping the ancestor beside the engine only invited the question of
which one to run. It is in the git history if you want to read it.

## Development

```sh
npm install
npm test         # rule-level tests: infra classification, grading, state migration, quoting,
                 # config merging, exit codes, the report, and the supervisor playbook's shape
npm run typecheck
npm run build
```

CI runs all three on Node 20, 22 and 24, on Linux and Windows.

## License

MIT. See [LICENSE](LICENSE).
