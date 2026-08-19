# runpulse

Supervised autonomous-run engine for coding agents. A milestone state machine that launches one
fresh headless agent session per milestone, grades what each session claims against written
evidence, and refuses to spend a retry on a usage limit.

The name is the thesis: the differentiator is the *pulse*, knowing a long run is alive and acting
when it isn't.

Status: **v0.3**. Engine, the active supervisor as an installable Claude Code skill, mid-flight steering, and an HTML run report.

## Install

```sh
npm install -g runpulse   # or: npx runpulse <command>
```

Requires Node 20+ and an agent CLI on PATH (Claude Code by default).

## Use

```sh
runpulse init --run my-run --milestones 5
# write .runpulse/protocol.md and the milestone prompts, then:
runpulse run
runpulse status
```

### Commands

| Command | What it does |
| --- | --- |
| `runpulse init [--run <name>] [--milestones <n>] [--force]` | Scaffold `.runpulse/`: config, state machine, protocol template, prompt skeletons. |
| `runpulse run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]` | Drain the run: one fresh agent session per milestone until complete or blocked. |
| `runpulse status [--json]` | Milestones, attempts, evidence counts, and the pulse. |
| `runpulse unblock <id> [--keep-attempts]` | Clear a block after fixing it; sets the milestone back to pending. |
| `runpulse steer ["<text>"] [--append] [--clear]` | Course-correct a run in flight; applies to the next session launched. |
| `runpulse report [--out <path>] [--open]` | Write a single self-contained HTML report of the run. |
| `runpulse skill install [--global] [--force] [--print]` | Install the supervisor skill into `.claude/skills/`. |
| `runpulse kill [--reason <text>]` | Supervisor intervention: kill the hung agent session. Never the runner. |
| `runpulse attend [--seconds <n>]` | Supervisor intervention: run the configured environment adapter. |

Exit codes: `0` ok, `1` error, `2` blocked.

## How a run works

```
init  ->  hand-write prompts  ->  run  ->  [session per milestone]  ->  complete | blocked
                                            |
                                            +-- writes .runpulse/result.json, engine grades it
```

1. **Fresh session per milestone.** Clean context every time. State lives in files, never in the
   conversation.
2. **The engine owns `state.json`.** The session writes one small drop box, `.runpulse/result.json`,
   with its status, its evidence lines and, when blocked, its diagnosis. The engine grades that,
   merges it, and archives the raw claim under `.runpulse/results/`.
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
runpulse skill install
```

Then, in a Claude Code session at the project root:

```
/loop 10m Use the runpulse-supervisor skill to perform one supervision cycle.
```

Each cycle it reads the whole run through `runpulse status --json` and applies the first matching
rule: healthy, environment stalled, agent session hung, waiting out a usage limit, runner dead,
blocked for real, or something it cannot explain. Its entire write surface is `runpulse kill`,
`runpulse attend`, relaunching `runpulse run`, and appending to `.runpulse/supervisor-log.md`. It
never edits project code, never touches `state.json`, and never runs the project's own tools while
a session owns them. Clearing a block stays a human decision.

`runpulse kill` targets the agent session, not the runner: the runner sees the session end, grades
it as incomplete, consumes an attempt and relaunches with a fresh context. The kill is recorded so
it cannot be mistaken for an infrastructure death and silently refunded.

**Environment adapter.** Playbook rule 3 unsticks a host-bound environment (window focus, a native
modal, a wedged tool server) by running `environment.attendCommand`. Point it at a script of your
own; the Unity one from the original run is in `reference/unity-attend.ps1`, ready to copy into a
project. A headless project leaves the command null and the rule simply cannot fire.

```json
"environment": {
  "attendCommand": "powershell -ExecutionPolicy Bypass -File .runpulse/adapters/unity-attend.ps1 -Seconds {{seconds}}",
  "attendSeconds": 120
}
```

## Steering a run in flight

You do not have to kill a run to correct it. `runpulse steer` writes `.runpulse/STEERING.md`, and
every session launched from that point on gets the text inlined into its kickoff as an override on
the milestone prompt:

```sh
runpulse steer "prefer the simpler fix over the general one"
runpulse steer --append "do not touch the public API"
runpulse steer            # show what is in force
runpulse steer --clear    # back to the milestone prompts alone
```

It persists until you clear it, and every attempt records the steering that was in force, so it is
always visible which sessions saw it. It overrides the prompt; it does not license dropping an
acceptance criterion. A steer that makes a milestone impossible comes back as `blocked`.

The supervisor cannot steer. If it thinks a run needs correcting, it proposes the wording and you
decide.

## The run report

```sh
runpulse report --open
```

One self-contained HTML file: stat tiles, a wall-clock timeline of every session that ran, a card
per milestone with its evidence and diagnosis, the attempt table, and the interventions. No
scripts, no external assets, so it opens offline and survives being sent to someone.

The timeline is the part `status` cannot give you: the gaps are as informative as the bars. A
usage-limit wait looks different from a slow session, and the infrastructure retries that were
never charged against the attempt budget are visible after the fact.

## Layout

```
.runpulse/
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
    "usageLimitPatterns": ["session limit", "usage limit", "rate limit", "429"]
  },
  "liveness": ["src", "tests/results/latest.txt"],
  "environment": { "attendCommand": null, "attendSeconds": 120 }
}
```

`args` placeholders: `{{kickoff}}`, `{{promptFile}}`, `{{milestoneId}}`, `{{projectRoot}}`,
`{{runpulseDir}}`, `{{model}}`. A different agent is a config change, not an engine change.

`liveness` is the list of paths whose mtime proves work is happening. Set it: without it `status`
can tell you a process exists, but not that it is doing anything.

## Roadmap

- **v0.1** engine: `init`, `run`, `status`, `unblock`. Done.
- **v0.2** active supervisor as an installable Claude Code skill; intervention log; environment
  adapter as a config string. Done.
- **v0.3** single-file HTML run report; steering file support. Done.
- **v0.4** plugin packaging; a second agent behind the config string.

Not yet validated: a full run driven by a real agent end to end. Everything above is exercised by
unit tests and by scripted agents, plus one real supervision cycle against a blocked run.

## Documentation

[docs/GUIDE.md](docs/GUIDE.md) is the user guide: the mental model, a full walkthrough, command and
config reference, grading and infra rules, use cases, recipes and troubleshooting.

## Background

[BRIEF.md](BRIEF.md) is the genesis document: where this comes from (two real overnight runs on a
Unity 6 game), what made those runs work, and the competitive landscape.
[docs/DECISIONS.md](docs/DECISIONS.md) records the product decisions and what was rejected.
`reference/` holds the original PowerShell implementation verbatim, as the behavioural spec.

## Development

```sh
npm install
npm test         # rule-level tests: infra classification, grading, state migration, quoting,
                 # config merging, and the supervisor playbook's shape
npm run typecheck
npm run build
```
