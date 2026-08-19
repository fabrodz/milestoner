# Product decisions

Resolves the "Product decisions to make first" section of [BRIEF.md](../BRIEF.md). Each entry is
dated, states the alternative that was rejected, and why. Superseding an entry means adding a new
one that points back at it, not editing history.

## D-001 - Runtime: Node CLI, not shell scripts (2026-08-18)

The engine is a Node CLI distributed on npm. `reference/orchestrator.ps1` is the behavioural
specification, not the codebase.

Rejected: keeping PowerShell. It is Windows-only, it string-parses JSON, and every rule that
matters (attempts, infra discrimination, evidence grading) is untestable there. Those rules are the
product; they need unit tests.

Not yet: the Claude Agent SDK. v0.1 spawns the agent as an opaque subprocess, which is what makes
D-005 possible. The SDK becomes interesting when we want streaming and cost telemetry, and it will
sit behind the same agent-config seam.

## D-002 - Distribution: npm first, Claude Code plugin later (2026-08-18)

`npx runpulse init|run|status|unblock` in v0.1. The supervisor ships as a Claude Code skill in v0.2
and the whole thing gets plugin packaging in v0.4.

The split follows the natural shape: the runner is a process that must survive a dead session, so
it is a CLI. The supervisor is judgement applied on a schedule, so it is a Claude session.

## D-003 - Supervisor host: a Claude session on `/loop` (2026-08-18)

Keep what already works overnight in production. No daemon, no service, no second process to
babysit. A daemon that spawns supervisor sessions is a v0.3+ question and only if `/loop` proves
insufficient.

## D-004 - Observability: `status` plus a pulse block in v0.1 (2026-08-18)

`runpulse status` prints the milestone table and a **pulse** block: is a runner process alive, what
is it on, how long has the current session been running, and how old is the newest liveness signal.

Liveness comes from side signals only - watched source dirs, test-result files, tool logs - never
from the transcript, because a headless `claude -p` flushes its transcript only at exit. The watch
list is `liveness` in config.json, per project.

Rejected for v0.1: the HTML report (v0.3) and a live web view. A status command a supervisor can
poll is the minimum that makes the pulse real.

## D-005 - The agent command is a config string from day one (2026-08-18)

`agent.command` plus an `agent.args` template with `{{kickoff}}`, `{{promptFile}}`,
`{{milestoneId}}`, `{{projectRoot}}`, `{{runpulseDir}}` and `{{model}}` placeholders. Swapping
Claude Code for Codex or Cursor is a config edit; the engine never learns agent names.

Only Claude Code is tested in v0.1. The seam is cheap now and expensive to retrofit.

## D-006 - The engine owns state.json; the session writes result.json (2026-08-18)

Departure from the reference implementation, where the executor session edited `state.json`
directly and the orchestrator trusted it.

The session now writes one small drop box, `.runpulse/result.json`:

```json
{ "milestone": "M01", "status": "done", "evidence": ["AC1: ..."], "notes": "" }
```

The engine grades it, merges it into `state.json`, and archives the raw claim under
`.runpulse/results/<id>-attempt<n>.json`. The agent's write surface shrinks from the whole state
machine to one file it cannot corrupt anything else with, and every attempt keeps its own record.

The trust rule from the reference survives intact: the verdict comes from what the session wrote,
never from its exit code.

## D-007 - Evidence is a gate the engine enforces, not a convention (2026-08-18)

`status: "done"` with an empty `evidence` array is downgraded to incomplete and retried. `blocked`
without a diagnosis (symptom + userAction) still blocks, because retrying a real block only burns
attempts, but the missing diagnosis is logged as a warning against that attempt.

## D-008 - Infra failures never consume an attempt (2026-08-18)

Ported from the reference and widened. A session is infrastructure, not work, when it wrote no
result **and** ended faster than `infra.deathSeconds`, and either its transcript is smaller than
`infra.tinyTranscriptBytes` or it matches a usage-limit pattern.

Widening: a usage-limit transcript counts even when it is large, and an announced reset time
("resets 3:00pm") is parsed and waited out exactly instead of sleeping a fixed ten minutes. A
parsed wait longer than twelve hours is treated as a misparse and falls back to the fixed wait.

The MVP run burned three attempts in forty seconds against a usage limit before this rule existed.

## D-009 - v0.1 scope: init, run, status, unblock (2026-08-18)

Supervisor skill and the adapter interface stay in v0.2 as the roadmap has them. `unblock` is the
one addition: with the engine owning state.json, clearing a block cannot be a hand edit any more.
Clearing it is always a human decision - the engine never resets a block on its own.
