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

**M05 is closed.** The user made the repository public later on 2026-08-20, which restored Actions;
the push of `main` ran the full matrix green (run 32428734950), M05 was unblocked, closed on its
second attempt against that run, and tagged `v05/M05`. The paragraph that stood here described the
deliberate `blocked` state that preceded all of that.

**The rewritten history is clean, but GitHub still serves the old objects.** The repository's history
was rewritten on 2026-08-20 to remove the originating project's name, its absolute paths, a Windows
username, and to unify four author identities into one. A fresh clone is clean. Force-pushing does
not make the pre-rewrite commits unreachable on GitHub, though: they are still served by SHA, with
their contents, and the only ways to be rid of them are a new repository or a purge request to
GitHub Support. The repository has since been made public, so this is no longer safe to defer
indefinitely: anyone holding a pre-rewrite SHA can read the old contents today. Deciding between a
purge request and living with it is the user's call, and it still gates nothing below.

## 1. A crashed session is charged an attempt it did not deserve - done

Closed 2026-08-20 by M06 of the continued `v05-debt` run. A transcript below
`infra.crashTranscriptBytes` (new, 100 B by default) with no `result.json` is now refunded as a
`crash` at any duration, while `tinyTranscriptBytes` keeps its existing job inside `deathSeconds`;
the usage-limit and pattern branches are untouched, and the refund shares the existing
`infra.maxRetries` ceiling. The three decisions the fix required are D-029. It was the most valuable
thing the v0.5 run produced, because the engine found it by failing at it: a real attempt out of
three, charged to a milestone that had already succeeded.

## 2. Tags and branches share a namespace, and git cannot tell them apart - done

Closed 2026-08-20 by M07 of the continued `v05-debt` run. Both halves landed:

The tag scheme in the protocol and milestone templates is now `<run>-<milestoneId>`, no slash, so a
tag can no longer share its name with the branch a session naturally creates for the same milestone
(`v05/M03` existed as both, and `git push origin v05/M03` failed with `src refspec matches more
than one`). Existing tags are left as they are.

The larger bug underneath it - `init` silently keeping a previous run's protocol - is closed at the
source: scaffolding over a `.milestoner/protocol.md` whose header names a different run now stops
`init` with exit 1 before anything is written, and says what to bring in line or delete. The
protocol stays hand-edited and is never rewritten; what is gone is the silence. This repository's
own protocol, which told five v0.5 sessions to tag `v04-plugin/<milestoneId>`, is brought in line
with `v05-debt` in the same milestone. The three decisions are D-030.

## 3. Publish to npm - now genuinely next

Deferred behind v0.5 on 2026-08-20 and nothing is left in front of it. The README and the guide both
document `npm install -g milestoner`; nothing is published, so both are writing a cheque the registry
will not cash. `milestoner` is free on npm.

Everything that should gate a publish is in place: LICENSE, CI green on all eight jobs across three
operating systems, a changelog with a dated `[0.5.0]`, a `files` list verified by `npm pack` (four
files, 43.7 kB), and a `prepublishOnly` that typechecks, tests and builds.

It is the only item here with an external audience, and the first one where a mistake is public.

## 4. A panel that spans runs - done

Closed 2026-08-20. The decision came first, as this file asked: D-033 argues the cross-run write
surface from D-027's precedent (same handlers, same server-side guards, resolved per request from
a `root` checked against the registry). What shipped: `serve --all` serves every registered run
with a hub and a per-run switcher; the first `milestoner run` spawns it as a detached daemon that
claims `~/.milestoner/panel.json`, stays while any run is alive plus ten minutes, and cleans up
after itself; every run prints the URL and `runs` reprints it; `--open` returns via a single-use
`/auth` token exchanged for a cookie, so the key never lands in browser history and D-027's
refusal stands for the attached panel. Still unexercised: the daemon across a reboot (a stale
`panel.json` whose pid was recycled is handled by the answer-probe, but nobody has watched it
happen), and the hub with more than a handful of runs.

## 5. Authoring flows in a UI, and the cheap experiment that would settle it

Milestone prompts are hand-written on purpose. That is the deliberate friction and the stated
difference from task-generating loops, and it is now recorded as D-031 rather than living only in a
genesis document. A flow builder would produce exactly the vague specifications the evidence gate
exists to reject, so building one means superseding D-031 in writing first.

Three options were weighed and the answer is not "no UI, end of discussion":

- **No authoring surface.** Prompts stay files; the panel stays read-and-intervene. This is the
  status quo and the recommendation.
- **A structured prompt editor.** A form carrying the sections the protocol expects, refusing to
  save a milestone with no acceptance criteria. The prompt stays text the user wrote.
- **A flow builder.** Boxes, arrows, dependencies, generated specifications. Ruled out: this is the
  one D-031 exists to refuse.

**What would settle the middle option is not a UI but a linter.** `milestoner lint` would check
every prompt before a run starts: does each milestone have acceptance criteria, does each criterion
name an evidence artifact, is there an exit section, does any one milestone carry two unrelated
gates. It captures most of what a structured editor would enforce, works in any editor, costs a
fraction of a UI, and gates a run before a single session launches, which is worth more than
catching a vague prompt after three attempts have been spent on it.

It also produces the evidence the decision needs. If hand-written prompts fail the linter often, a
structured editor has a case. If they pass, it does not, and the question is closed with data
instead of taste.

## Order

0 is not really a task but a debt, and both halves of it are waiting on the same decision about what
happens to the repository. Nothing below it is blocked by it, which is the only reason the rest can
proceed at all.

1, 2 and 4 are done. 3 cannot happen before 0 is settled, because publishing from a repository whose
history is still being decided is the wrong order. 5 is still a question, not a task.
