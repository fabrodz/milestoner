---
description: Scaffold a new milestoner run in this project - config, state machine, protocol template, and milestone prompt skeletons - then walk the user through filling them in.
argument-hint: "[--run <name>] [--milestones <n>]"
---

# Start a milestoner run

Set up an autonomous run in the current project and hand the user a clear next step. milestoner is a
milestone state machine: it launches one fresh headless agent session per milestone and grades what
each session claims against written evidence.

## Do

1. Run `milestoner init $ARGUMENTS` from the project root. With no arguments it names the run after the
   directory and scaffolds five milestones; pass `--run <name>` and `--milestones <n>` to override.
   Use `--force` only if the user means to overwrite an existing `.milestoner/config.json`.
2. Read what it wrote so you can describe it: `.milestoner/protocol.md` (the shared rules every session
   reads first), `.milestoner/prompts/M01.md` and friends (one hand-written spec per milestone), and
   `.milestoner/config.json`.

## Report

Tell the user what was created and what only they can do next, in order:

- Edit `.milestoner/protocol.md`: replace every TODO with this project's rules.
- Write each `.milestoner/prompts/M0x.md`: objective, tasks, acceptance criteria, exit.
- Set the milestone titles in `.milestoner/state.json` to match.
- Point `"liveness"` in `.milestoner/config.json` at the paths that prove work is happening (source
  dirs, test-result files, tool logs). The transcript is never one.
- Then `milestoner run`.

Do not write the milestone prompts for them unless they ask; the prompts are the run, and they are
the user's to author. Never edit `.milestoner/state.json` yourself - the engine owns it, and setting
the titles is the user's edit to make.
