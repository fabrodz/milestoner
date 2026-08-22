# What to do next

Rewritten 2026-08-22, after the `v09-panel` and `v10-ux` runs closed and 0.9.0 was published.

## Where things stand

**The engine has been used on itself five times** (`v04-plugin`, `v05-debt`, `v08-lint`,
`v09-panel`, `v10-ux`): twenty-three milestones, twenty-three fresh Claude Code sessions, each
graded against its written evidence, twenty-two closed on the first attempt. The one that did not
was a session that died before writing its result; the next one found the work uncommitted,
reviewed it against the milestone's tasks, finished what was missing and closed it - which is the
case the grading loop exists for.

**0.9.0 is published**: npm, the tag, and a GitHub release. Releases are made by hand - the
tag-triggered workflow lasted one release, failed its only publish on npm auth, and a publish is
one command with `prepublishOnly` already gating it. `[Unreleased]` is empty; what sits on `main`
past the tag is two test fixes for paths that only CI's temp directories produce (macOS resolving
`/var` to `/private/var`, Windows spelling one `RUNNER~1`).

**The panel is the whole surface now.** A run can be created, its prompts and protocol written, its
config and per-milestone models edited, started with every option the CLI takes, steered, killed,
unblocked and read without leaving the browser (D-036 to D-038). What still needs a terminal is
bringing the panel up the first time.

## 1. Test debt

Paid off since the last rewrite: `api.ts` has direct tests against fixture layouts
(`src/server/api.test.ts`, added by `v09-panel`, which found a `?name=` with nothing in it
answering 500), and `page.ts` now renders through a pure card builder that
`src/server/page.test.ts` exercises directly - live-session cards, empty states, the one-line
card explanations and the tooltips.

Still bare, in rough order of value:

- `status --json` - the contract the supervisor skill consumes as its primary signal.
- `attend`'s `(seconds + 60) * 1000` timeout. The shell-out and the `{{seconds}}` substitution are
  covered through `doAttend`; what a command that never returns does is not.
- `cli.ts` - nothing tests argument parsing, including the two mutually-exclusive-flag guards
  around `--open`/`--serve`/`--no-panel`.
- `panel.ts` has no tests of its own.
- Tests that compare filesystem paths across a process or URL boundary need the CI lesson applied
  up front: compare against `realpathSync` and against the same serializer the code uses, never
  against the spelling the test happened to create.

## 2. Still unexercised by a real run

- A run long enough to hit a real usage limit or agent fallback mid-flight.
- A non-Claude agent across a whole run rather than a single milestone.
- The supervisor loop against a live multi-milestone run rather than the one blocked run it has
  been tried on.
- The machine-panel daemon across a reboot (a stale `panel.json` with a recycled pid is handled by
  the answer-probe, but nobody has watched it happen), and the hub with more than a handful of
  runs.
- `milestoner add` mid-run in anger: the append is proven against a live runner by a test, not yet
  by a person growing a plan while it drained.

## 3. The linter experiment has its data; the question is ready to call

Three runs have now started under the gate (D-035). Every hand-written prompt passed: `v08-lint`,
`v09-panel` and `v10-ux` each logged `lint | 0 errors, 0 warnings` at every start, across fifteen
milestones written by the planner interview. The one time the gate fired in earnest was a
scaffolded run nobody had written yet - thirty-six `template-residue` errors on three untouched
skeletons - which is the gate doing exactly its job and says nothing about hand-written prompts.

That is the evidence D-031/D-032 asked for, and it points one way: prompts written through the
planner interview do not fail the form rules, so a structured prompt editor solves a problem the
data does not show. The panel's plain-text prompt editor (v10-ux) covers what the browser actually
needed. Worth writing the conclusion into D-031 as a closed question rather than leaving it open.

## 4. UI, deferred deliberately

- The panel's layout: the density and hierarchy question a user raised on 2026-08-22 ("tal vez
  podría verse todo en una pantalla de forma resumida pero ver detalles al clickear"). Deferred on
  purpose - it is a taste decision to iterate on with mockups, not to hand to an autonomous run
  against written criteria.
- A read-only panel disables its controls without saying why. The server says it plainly
  ("this panel is read-only; restart with --write"); the page should too, instead of leaving a
  disabled input to be diagnosed.

## Order

1 and 2 stay opportunistic: close them when a change touches the area, or when a real run offers
the scenario. 3 is a short writing job whenever it is wanted. 4 needs a conversation before it
needs a run.
