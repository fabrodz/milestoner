# What to do next

Rewritten 2026-08-20 on closing v0.5, superseding the version written earlier the same day. That
file listed five items; three are done, one is unchanged, and the run that closed them produced two
findings that were not on it at all.

## Where things stand

**The engine has now been used on itself twice.** v0.4 was built as a four-milestone run
(`v04-plugin`) and v0.5 as another (`v05-debt`): eight milestones, eight fresh Claude Code sessions,
each graded against its written evidence. Seven closed on the first attempt.

The eighth is the interesting one. M03's session did the work, pushed a branch, got a green CI matrix
on all eight jobs, and then died with a fifteen-byte `Execution error` transcript before writing
`result.json`. The engine graded it `incomplete` and charged the attempt. It closed on the retry in
four minutes, because the retry found the work already done and only had to verify and report.

Still unexercised, unchanged from the last version of this file: a run long enough to hit a real
usage limit or agent fallback mid-flight, a non-Claude agent across a whole run rather than a single
milestone, and the supervisor loop against a live multi-milestone run rather than the one blocked run
it has been tried on.

## 0. Two things are owed before anything else here

**M05's fix is on `main` without the Linux verification its own gate asked for.** The lock fix
(D-028) is merged and green on Windows at 111/111, but AC3 wanted a green CI matrix and CI is
unavailable: the repository is private and the GitHub account's Actions minutes are exhausted. The
milestone is still `blocked` in `.milestoner/state.json`, deliberately, and there is no `v05/M05`
tag. The session itself refused to merge or tag for exactly this reason; merging was an operator
decision taken because leaving a known lost-update bug on `main` is worse than merging a fix that
three platforms have not yet all agreed on. Close it properly when CI returns: `milestoner unblock
M05`, let the retry read the matrix, then tag.

**The rewritten history is clean, but GitHub still serves the old objects.** The repository's history
was rewritten on 2026-08-20 to remove the originating project's name, its absolute paths, a Windows
username, and to unify four author identities into one. A fresh clone is clean. Force-pushing does
not make the pre-rewrite commits unreachable on GitHub, though: they are still served by SHA, with
their contents, and the only ways to be rid of them are a new repository or a purge request to
GitHub Support. The repository is private in the meantime, which is what makes that safe to defer.
It is also why Actions is unavailable, so this item and the one above are the same item wearing two
hats.

## 1. A crashed session is charged an attempt it did not deserve

New, and the most valuable thing the v0.5 run produced, because the engine found it by failing at it.

`classifyInfraFailure` in `src/session.ts` returns `null` for anything that ran longer than
`infra.deathSeconds` (90 by default) before testing whether the transcript is tiny. The reasoning was
sound when it was written: a session that ran for a quarter of an hour has not died instantly, so an
instant-death rule should not claim it. But a fifteen-byte transcript after fifteen minutes is not a
milestone that failed. It is an agent that crashed, and the milestone should not pay for it.

The shape of the fix is a pattern the classifier does not have: a transcript far below
`tinyTranscriptBytes` is evidence of a crash *at any duration*, where the duration bound only ever
made sense as a guard against misreading a fast legitimate failure. Whether that means dropping the
bound for the tiny-transcript branch alone, or a second lower threshold that ignores duration, is the
decision. Both leave the usage-limit and pattern branches untouched.

Not academic: it cost a real attempt out of three on a milestone that had already succeeded.

## 2. Tags and branches share a namespace, and git cannot tell them apart

Also new, and small. The run tags milestones `v05/M01` and works on branches named `v05/M03`, so
`git push origin v05/M03` fails with `src refspec v05/M03 matches more than one` and has to be
disambiguated with `refs/heads/`. v0.4 never hit it because no milestone in that run needed a branch.

Any milestone that works on a branch will hit it again. Pick one namespace and change the other:
tags carrying no slash, or branches as `wip/M03`, which is what M05 used and which worked.

**Tracing this found the larger bug underneath it.** `.milestoner/protocol.md` section 5 tells the
session to tag `v04-plugin/<milestoneId>` while the run is `v05-debt`, and the reason is in
`src/commands/init.ts`: the protocol is written with `writeFileIfMissing`, so scaffolding a new run
over an existing `.milestoner/` keeps the previous run's protocol, name and all. Every one of v0.5's
five sessions read a protocol naming a run that had finished, and nothing warned anyone.

`writeFileIfMissing` is the right call on its own terms, because the protocol is meant to be
hand-edited and overwriting it would discard the project's rules. Silently keeping a stale run name
is not. A warning when the protocol names a different run than the one being scaffolded is the small
version; templating the run name out of the protocol body is the larger one.

What makes this worth more than its size: for the whole run the protocol and the plan disagreed
about a concrete instruction, and five sessions resolved it the same way without mentioning it. The
agents followed the plan. Nothing in the engine noticed the two documents were in conflict, and
nothing in the evidence records that a choice was made.

## 3. Publish to npm - now genuinely next

Deferred behind v0.5 on 2026-08-20 and nothing is left in front of it. The README and the guide both
document `npm install -g milestoner`; nothing is published, so both are writing a cheque the registry
will not cash. `milestoner` is free on npm.

Everything that should gate a publish is in place: LICENSE, CI green on all eight jobs across three
operating systems, a changelog with a dated `[0.5.0]`, a `files` list verified by `npm pack` (four
files, 43.7 kB), and a `prepublishOnly` that typechecks, tests and builds.

It is the only item here with an external audience, and the first one where a mistake is public.

## 4. A panel that spans runs

The registry landed in v0.5 (D-025) and the panel now comes up with the run (D-027), so what is left
is the view across them. `serve` still answers for one project directory.

The blocker is a decision, not code: D-020 scoped the panel's write surface to the project it was
started in, and a cross-run panel means one process acting on projects it was not started in. D-027
already had to rule on a smaller version of the same question and chose to keep `--write` while
refusing the one control that conflicts. That is the precedent to argue from.

## 5. Still unanswered: authoring flows in a UI

Carried over unchanged, for the third time. Milestone prompts are hand-written on purpose; that is
the deliberate friction and the stated difference from task-generating loops. A flow builder would
produce exactly the vague specs the evidence gate exists to catch.

There is a defensible version - a UI that shows an existing run's shape and edits ordering and
titles, with the prompt files staying hand-written text. If the goal is really authoring in a GUI,
that supersedes a decision in BRIEF.md and should be written down as one before any screen is built.

Planned separately in [PLAN-flow-authoring.md](PLAN-flow-authoring.md), because it is a decision
first and work only if the decision goes a particular way.

## Order

0 is not really a task but a debt, and both halves of it are waiting on the same decision about what
happens to the repository. Nothing below it is blocked by it, which is the only reason the rest can
proceed at all.

1 and 2 are small and both came out of using the tool, so they are the cheapest things here and
should go first. 3 cannot happen before 0 is settled, because publishing from a repository whose
history is still being decided is the wrong order. 4 needs its decision written before any screen.
5 is still a question, not a task.
