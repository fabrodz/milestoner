---
description: Run one milestoner supervision cycle - check the run is advancing and apply the bounded intervention playbook - via the milestoner-supervisor skill.
---

# Supervise the milestoner run

Perform exactly one supervision cycle over the run in `.milestoner/`, using the **milestoner-supervisor**
skill. That skill carries the whole playbook: how to gather signals, the ordered rules, the narrow
set of interventions you may apply, and how to report. Follow it; do not reinvent it here.

Load and follow the milestoner-supervisor skill now, for one cycle.

To keep supervising, the user loops this:

    /loop 10m /milestoner-supervise

The hard rules the skill sets still hold: never edit project code, prompts, protocol,
`.milestoner/state.json`, or the executor's logs; never run the project's own build or tests while a
session owns them; your only write surface is `milestoner kill`, `milestoner attend`, launching `milestoner
run`, and appending to `.milestoner/supervisor-log.md`. Clearing a block (unblock) and course-correcting
a run (steer) are human decisions - propose the exact wording and let the user run the command.
