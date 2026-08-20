# milestoner — product brief (genesis)

Seeded 2026-08-18 from two autonomous runs on a private Unity 6 project. This document is the handoff context: read it fully before designing anything.

## What it is

**milestoner** is a supervised autonomous-run engine for coding agents: a milestone state machine that launches one fresh headless agent session per milestone, plus an **active supervisor** that keeps the run alive overnight — detecting stalls, waiting out usage limits without burning retries, restarting dead pieces, and escalating only what genuinely needs a human. Generic across project types (web, backend, CLI, games); Claude Code first, other agents later.

The name is the thesis. A milestone only counts when something on disk proves it: a passing test, a diff, a commit. The engine runs one fresh session per milestone, grades what that session claims against the evidence it left behind, and moves the marker only when the two agree.

## Where it comes from (proven in production)

Extracted from two real runs on a Unity 6 game (a private project; the run lived under its `docs/execution/`):

- **MVP run**: 12 milestones, ~10.5h overnight, 257 EditMode tests green, one retry consumed by a real bug, one block caused by infrastructure (usage limit) — not by the work.
- **v1.1 run**: 5 milestones prepared with the hardened engine (in progress at handoff time).

What made it work:

1. **Fresh session per milestone** — clean context every time, no long-context degradation. State lives in files, never in the conversation.
2. **`state.json` state machine** — per milestone: `status` (pending / in_progress / done / blocked), `attempts` (budget, default 3), `evidence` (written proof per acceptance criterion). The orchestrator trusts state.json over exit codes.
3. **Gates with mandatory evidence** — a milestone is done when its acceptance criteria have written/screenshot/log evidence, not when the session says so. Executors keep an append-only `execution-log.md` and a `decisions.md` for autonomous choices.
4. **`blocked` semantics** — blocking requires a written diagnosis: exact symptom, everything tried, the single clearest user action. Blocked ≠ failed.
5. **Git tags as checkpoints** — every green milestone is a tag; rollback is `git reset --hard <tag>` + a state.json edit.
6. **Infra failures ≠ milestone failures** — a session that dies in <90s with a tiny transcript (usage limit, auth, network) must NOT consume an attempt. The MVP run burned 3 attempts in 40 seconds against a usage limit before this rule existed.
7. **Active supervisor with a bounded playbook** — a Claude session looping every ~10 min (`/loop`) with narrow, logged intervention powers: refocus/unstick the environment, kill a hung executor (orchestrator retries), wait out usage-limit resets then reset+relaunch, relaunch a dead orchestrator, escalate real blocks. Never edits project code. Two failed interventions on the same milestone → stop and escalate.
8. **Liveness is inferred from side signals**, never from the transcript — headless `claude -p` flushes output only at exit. Real signals: tool-server logs, test-result files, source-file mtimes, git commits.

## Competitive landscape

**ralphloop.sh** (the packaged "Ralph loop", npm `@pageai/ralph-loop`) is the closest thing: task-list-driven loop, multi-agent (Claude Code / Cursor / Codex / Copilot / Gemini), Docker sandbox per agent, PRD/task-spec generation, live observability (step detection, stream preview, screenshots, timing), mid-flight steering via `STEERING.md`.

milestoner's differentiation (verified gaps as of 2026-08-18):

- **Milestone state machine with gates + evidence + attempts + blocked-with-diagnosis** vs a flat task list.
- **Active supervisor that intervenes** vs passive observability.
- **Infra-failure discrimination** (usage limits don't burn retries).
- **Host-bound environments**: runs that need a live GUI process on the host (Unity/Unreal/Godot editors via MCP, live devices) are incompatible with Docker sandboxes. Environment quirks (window focus, native modal dialogs) are handled by pluggable **environment adapters** — the Unity adapter (focus keeper + Win32 modal dismissal) already exists as `examples/adapters/unity-attend.ps1`.

Honest note: for plain sandboxable CLI projects, ralph-loop is good; milestoner must win on run *reliability* (the pulse) and on discipline (gates/evidence), or by absorbing those projects too with a lower-friction UX.

## Architecture: three layers, kept separate

1. **Engine** (100% generic, the product): state machine, session runner with infra-failure handling, supervisor loop + playbook, liveness heuristics, adapter interface.
2. **Project protocol** (parameterized template): commit conventions, where evidence goes, testing rules, session start/end ritual, decision logging. One `_protocol.md` per project, generated from a template by `init`.
3. **Milestone prompts** (always hand-written per project): objective, tasks, gates, exit. This is where the actual work is specified; the engine never generates these silently.

## Reference implementation

The run this was seeded from carried its own tooling (Windows/PowerShell, Claude Code CLI): an
orchestrator script, a project protocol, an active supervisor prompt and a read-only predecessor, a
Unity environment adapter, and a state file. They were the behavioural specification while the
engine was written.

Each has a successor in the product and the originals have been removed from the tree; they are in
the git history:

| Original | What replaced it |
| --- | --- |
| `orchestrator.ps1` | `src/runner.ts` and the rest of the engine |
| `_protocol.md` | `src/templates/protocol.ts`, written by `milestoner init` |
| `SUPERVISOR.md` | `src/templates/skill.ts`, written by `milestoner skill install`, with tests over its playbook |
| `MONITOR.md` | superseded by the supervisor before the engine existed |
| `state-example.json` | `src/state.test.ts`, which exercises the legacy format it documented |
| `unity-attend.ps1` | still shipped, in `examples/adapters/`: the adapter is the one piece the engine cannot supply |

## Product decisions to make first (in this order)

> Resolved on 2026-08-18 in [docs/DECISIONS.md](docs/DECISIONS.md) (D-001..D-009). Kept here as the original framing.

1. **Runtime**: Node CLI (cross-platform, npm distribution, can later wrap the Claude Agent SDK for streaming/cost telemetry) vs keeping shell scripts. Recommendation from the runs: Node CLI; the .ps1 is Windows-only and string-parses everything.
2. **Distribution**: npm package (`npx milestoner init|run|supervise`) + a Claude Code plugin exposing `/milestoner-init` and `/milestoner-supervise`. The supervisor is naturally a Claude skill; the runner is naturally a CLI.
3. **Supervisor host**: a Claude session with `/loop` (current, works today) vs a daemon that spawns supervisor sessions (later). Start with the former.
4. **Observability** ("the pulse"): minimum lovable = a status command + a single-file HTML report of the run (milestones, attempts, interventions, liveness timeline). Live web view later.
5. **Multi-agent**: design the runner so the agent command is a config string from day one, even if only Claude Code is tested initially.

## Suggested roadmap

- **v0.1**: `milestoner init` (scaffolds `.milestoner/` with state.json, protocol template, prompt skeletons) + `milestoner run` (Node port of orchestrator.ps1 incl. infra-failure rules) + `milestoner status`.
- **v0.2**: supervisor as installable Claude Code skill; intervention log; adapter interface with the Unity adapter ported as the reference example.
- **v0.3**: HTML run report; steering file support (à la Ralph, it's a good idea).
- **v0.4**: plugin packaging + marketplace repo; second agent (Cursor CLI or Codex) behind the config string.
