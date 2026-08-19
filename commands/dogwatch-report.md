---
description: Generate the single-file HTML run report for this dogwatch run and open it. Read-only.
argument-hint: "[--out <path>] [--open]"
---

# Build the dogwatch run report

Render the run in `.dogwatch/` to one self-contained HTML file: stat tiles, a wall-clock timeline of
every session, a card per milestone with its evidence and diagnosis, the attempt table, and the
interventions. It has no scripts and no external assets, so it opens offline and survives being sent
to someone.

## Do

1. Run `dogwatch report $ARGUMENTS`. With no arguments it writes `.dogwatch/report.html`; pass
   `--open` to open it in the browser, or `--out <path>` to write it elsewhere.
2. Tell the user where the file is.

## Report

- Where the report was written.
- If the user asks what stands out, one line on it: the timeline gaps (a usage-limit wait looks
  different from a slow session), any blocked milestone, attempts spent.

This is read-only. It reads `.dogwatch/state.json` and the logs; it never edits them.
