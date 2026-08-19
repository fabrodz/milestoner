# runpulse

Supervised autonomous-run engine for coding agents. A milestone state machine that launches one
fresh headless agent session per milestone, grades what each session claims against written
evidence, and refuses to spend a retry on a usage limit.

The name is the thesis: the differentiator is the *pulse*, knowing a long run is alive and acting
when it isn't.

Status: **v0.1**. Engine only. The active supervisor lands in v0.2.

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

## Layout

```
.runpulse/
  config.json          agent command, attempts, infra rules, liveness watch list
  state.json           the state machine (engine-owned)
  protocol.md          shared rules every session reads first
  prompts/M01.md       hand-written milestone specs: objective, tasks, gates, exit
  results/             archived per-attempt claims
  logs/                session transcripts
  run-log.md           append-only engine events
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
  "liveness": ["src", "tests/results/latest.txt"]
}
```

`args` placeholders: `{{kickoff}}`, `{{promptFile}}`, `{{milestoneId}}`, `{{projectRoot}}`,
`{{runpulseDir}}`, `{{model}}`. A different agent is a config change, not an engine change.

`liveness` is the list of paths whose mtime proves work is happening. Set it: without it `status`
can tell you a process exists, but not that it is doing anything.

## Roadmap

- **v0.1** engine: `init`, `run`, `status`, `unblock`.
- **v0.2** active supervisor as an installable Claude Code skill; intervention log; adapter
  interface with the Unity adapter as the reference example.
- **v0.3** single-file HTML run report; steering file support.
- **v0.4** plugin packaging; a second agent behind the config string.

## Background

[BRIEF.md](BRIEF.md) is the genesis document: where this comes from (two real overnight runs on a
Unity 6 game), what made those runs work, and the competitive landscape.
[docs/DECISIONS.md](docs/DECISIONS.md) records the product decisions and what was rejected.
`reference/` holds the original PowerShell implementation verbatim, as the behavioural spec.

## Development

```sh
npm install
npm test         # rule-level tests: infra classification, grading, state migration, quoting
npm run typecheck
npm run build
```
