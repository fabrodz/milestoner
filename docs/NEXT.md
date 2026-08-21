# What to do next

Rewritten 2026-08-21, on cutting v0.7.0. The pre-rewrite-history question that used to sit here is
gone: the repository was recreated fresh, so the old objects are no longer served by anyone.

## Where things stand

**The engine has been used on itself twice** (`v04-plugin`, `v05-debt`): eight milestones, eight
fresh Claude Code sessions, each graded against its written evidence, seven closed on the first
attempt. **It is published and current**: 0.7.0 shipped everything that had accumulated in
`[Unreleased]` - the planner skill, the machine panel, `skill install -g`, the plugin retirement.
The registry and the README describe the same binary again. Releases are published by hand: the
tag-triggered workflow lasted one release, failed its only publish on npm auth, and a publish is
one command with `prepublishOnly` already gating it.

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

## 3. Authoring flows in a UI, and the cheap experiment that would settle it

Still a question, not a task. Milestone prompts are hand-written on purpose (D-031); a flow
builder would produce exactly the vague specifications the evidence gate exists to reject, so
building one means superseding D-031 in writing first.

**What would settle the middle option (a structured prompt editor) is not a UI but a linter.**
`milestoner lint` would check every prompt before a run starts: does each milestone have
acceptance criteria, does each criterion name an evidence artifact, is there an exit section, does
any one milestone carry two unrelated gates. It captures most of what a structured editor would
enforce, works in any editor, costs a fraction of a UI, and gates a run before a single session
launches. If hand-written prompts fail it often, a structured editor has a case; if they pass, the
question is closed with data instead of taste. This is the experiment D-032 refers to; the planner
skill's checklist is a conversational stand-in for it, not a replacement.

## Order

1 and 2 are opportunistic: close them when a change touches the area, or when a real run offers
the scenario. 3 stays a question until the linter produces data, which makes the linter the next
piece of deliberate work.
