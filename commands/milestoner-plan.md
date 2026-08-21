---
description: Plan a milestoner run with the user - interview, break the goal into milestones, and write evidence-backed prompts - via the milestoner-planner skill.
argument-hint: "[goal]"
---

# Plan a milestoner run

Help the user turn a goal into a run the engine can grade, using the **milestoner-planner** skill.
That skill carries the whole method: what to read and ask first, what makes a milestone work in this
engine, the writing steps, and the checklist to walk before handing over. Follow it; do not reinvent
it here.

Load and follow the milestoner-planner skill now. If the user gave a goal, start from it: $ARGUMENTS

The hard rules the skill sets still hold: nothing is written to disk before the user approves the
milestone breakdown; never invent an acceptance criterion the user has not confirmed; never edit
`.milestoner/state.json` except the milestone titles, and only while no runner is alive and the
milestone is pending with zero attempts; never launch `milestoner run` yourself - starting the run
is the user's call.
