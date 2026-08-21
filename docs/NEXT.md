# What to do next

Rewritten 2026-08-21, on cutting v0.7.0; updated the same day after the `v08-lint` run closed. The
pre-rewrite-history question that used to sit here is gone: the repository was recreated fresh, so
the old objects are no longer served by anyone.

## Where things stand

**The engine has been used on itself three times** (`v04-plugin`, `v05-debt`, `v08-lint`): twelve
milestones, twelve fresh Claude Code sessions, each graded against its written evidence, eleven
closed on the first attempt. **It is published**: 0.7.0 is current on npm. Releases are published
by hand: the tag-triggered workflow lasted one release, failed its only publish on npm auth, and a
publish is one command with `prepublishOnly` already gating it. `[Unreleased]` again holds a
finished feature - `milestoner lint`, the run gate and the panel's lint parity (D-035) - so the
next deliberate step is cutting 0.8.0.

## 1. Test debt

A sweep on 2026-08-21 closed the two worst gaps (`secondsUntilReset`, which gates the usage-limit
behaviour the README leads with, and `skill install`). Still bare, in rough order of value:

- `status --json` - the contract the supervisor skill consumes as its primary signal.
- `attend` - the shell-out with template substitution and its `(seconds + 60) * 1000` timeout.
- The `api.ts` handlers, exercised only indirectly through `http.test.ts`.
- `cli.ts` - nothing tests argument parsing, including the two mutually-exclusive-flag guards
  around `--open`/`--serve`/`--no-panel`.
- The renderers: `report.ts` has tests, `panel.ts` and `page.ts` have none.

## 2. Still unexercised by a real run

Carried forward, plus what v0.6 added:

- A run long enough to hit a real usage limit or agent fallback mid-flight.
- A non-Claude agent across a whole run rather than a single milestone.
- The supervisor loop against a live multi-milestone run rather than the one blocked run it has
  been tried on.
- The machine-panel daemon across a reboot (a stale `panel.json` with a recycled pid is handled by
  the answer-probe, but nobody has watched it happen), and the hub with more than a handful of
  runs.

## 3. The linter exists; the experiment is now collecting data

The linter shipped in the `v08-lint` run (D-035): `milestoner lint` and `lint --json`,
`milestoner run` refuses to start on error-level findings for pending milestones with `--no-lint`
as the escape, the panel has the same read, gate and override, and every run start writes a
`lint: N errors, M warnings` line to `run-log.md`. That line is the experiment D-032 refers to:
if hand-written prompts fail the linter often, a structured prompt editor has a case; if they
pass, the question closes with data instead of taste.

First datapoint, for what a sample of one is worth: the `v08-lint` run's own hand-written prompts
passed with 0 errors and 0 warnings. What remains is to read the accumulated lint lines after a
few more real runs and call it. Until then a flow builder stays rejected (D-031), and the
semantic checks the linter deliberately does not do - unrelated gates in one milestone, prompts
that are not self-contained - stay with the planner skill.

## Order

1 and 2 are opportunistic: close them when a change touches the area, or when a real run offers
the scenario. 3 is now a waiting game, not work: let runs accumulate lint lines, then decide. The
next deliberate step is cutting 0.8.0.
