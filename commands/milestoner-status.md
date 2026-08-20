---
description: Report the state of the milestoner run in this project - milestones, attempts, evidence, and whether the runner is alive. Read-only.
---

# Report the milestoner run

Give the user a compact, accurate read of the run. This is read-only: you observe and report, you do
not intervene.

## Do

1. Run `milestoner status` for the human-readable table, or `milestoner status --json` when you need the
   exact numbers to reason about.
2. If the run looks stalled or blocked and the user wants context, add `tail -n 20
   .milestoner/run-log.md` (engine events) and `git log --oneline -5` (real progress leaves commits).

## Report

- Which milestone is current and its status; how many are done, blocked, pending.
- The pulse: whether a runner process is alive, what it is on, and how old the newest liveness signal
  is.
- Any blocked milestone's diagnosis, quoted: the symptom and the single user action it asks for.

Do not act on what you find. Starting, killing, or steering a run are separate, deliberate steps -
`milestoner run`, the `/milestoner-supervise` cycle, or the human-only commands. Never edit
`.milestoner/state.json`.
