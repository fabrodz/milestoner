---
description: Run one dogwatch supervision cycle - check the run is advancing and apply the bounded intervention playbook - via the dogwatch-supervisor skill.
---

# Supervise the dogwatch run

Perform exactly one supervision cycle over the run in `.dogwatch/`, using the **dogwatch-supervisor**
skill. That skill carries the whole playbook: how to gather signals, the ordered rules, the narrow
set of interventions you may apply, and how to report. Follow it; do not reinvent it here.

Load and follow the dogwatch-supervisor skill now, for one cycle.

To keep supervising, the user loops this:

    /loop 10m /dogwatch-supervise

The hard rules the skill sets still hold: never edit project code, prompts, protocol,
`.dogwatch/state.json`, or the executor's logs; never run the project's own build or tests while a
session owns them; your only write surface is `dogwatch kill`, `dogwatch attend`, launching `dogwatch
run`, and appending to `.dogwatch/supervisor-log.md`. Clearing a block (unblock) and course-correcting
a run (steer) are human decisions - propose the exact wording and let the user run the command.
