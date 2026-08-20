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
tags as `v0.5-M03`, or branches as `wip/M03`. The tag scheme is what `.milestoner/protocol.md`
section 5 names, and that file still says `v04-plugin/<milestoneId>` from the previous run while the
plans have been saying `v05/<id>`. Both agents followed the plan and ignored the protocol, which is
its own small finding about which document an agent actually reads.

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

1 and 2 are small and both came out of using the tool, so they are the cheapest things here and
should go first. 3 is next and is the only item that changes anything for anyone outside this
repository. 4 needs its decision written before any screen. 5 is still a question, not a task.
