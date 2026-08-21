# What to do next

Rewritten 2026-08-21, after 0.6.1 went to npm and the working tree retired the plugin channel
(D-034). The previous version was written on closing v0.5; of its five items, four are done and
one is carried forward unchanged.

## Where things stand

**The engine has been used on itself twice** (`v04-plugin`, `v05-debt`): eight milestones, eight
fresh Claude Code sessions, each graded against its written evidence, seven closed on the first
attempt. **It is published**: 0.6.0 was the first version on npm, 0.6.1 (documentation only) is
current.

`main` is ahead of the registry: the planner skill, the machine panel, `skill install -g`, the
plugin retirement and a tag-triggered publish workflow are all in `[Unreleased]`. The README
describes them, so until the next release the npm front page is ahead of the binary it installs.

## 1. Cut v0.7.0

Nothing is in front of it: date the changelog, bump `package.json`, tag `v0.7.0`, push the tag.
`publish.yml` does the rest - and this is its first live exercise, so the one-time setup has to
exist first: a trusted publisher for this repository and workflow file, configured in the
package's settings on npmjs.com. If the workflow fails on auth, that setup is what is missing.

## 2. The rewritten history is clean, but GitHub still serves the old objects

Unchanged from the last version of this file. The history was rewritten on 2026-08-20 to remove
the originating project's name, its absolute paths, a Windows username, and to unify four author
identities; a fresh clone is clean, but the pre-rewrite commits are still served by SHA on GitHub,
with their contents, and the repository is public. The only exits are a new repository or a purge
request to GitHub Support. The user's call. It gates nothing below, which is the only reason
anything below can proceed.

## 3. Test debt

A sweep on 2026-08-21 closed the two worst gaps (`secondsUntilReset`, which gates the usage-limit
behaviour the README leads with, and `skill install`). Still bare, in rough order of value:

- `status --json` - the contract the supervisor skill consumes as its primary signal.
- `attend` - the shell-out with template substitution and its `(seconds + 60) * 1000` timeout.
- The `api.ts` handlers, exercised only indirectly through `http.test.ts`.
- `cli.ts` - nothing tests argument parsing, including the two mutually-exclusive-flag guards
  around `--open`/`--serve`/`--no-panel`.
- The renderers: `report.ts` has tests, `panel.ts` and `page.ts` have none.

## 4. Still unexercised by a real run

Carried forward, plus what v0.6 added:

- A run long enough to hit a real usage limit or agent fallback mid-flight.
- A non-Claude agent across a whole run rather than a single milestone.
- The supervisor loop against a live multi-milestone run rather than the one blocked run it has
  been tried on.
- The machine-panel daemon across a reboot (a stale `panel.json` with a recycled pid is handled by
  the answer-probe, but nobody has watched it happen), and the hub with more than a handful of
  runs.

## 5. Authoring flows in a UI, and the cheap experiment that would settle it

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

1 is one tag plus one npmjs.com setting, and everything user-visible waits on it. 2 is a decision,
not a task, and gates nothing. 3 and 4 are opportunistic: close them when a change touches the
area, or when a real run offers the scenario. 5 stays a question until the linter produces data.
