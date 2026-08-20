# What to do next

Rewritten 2026-08-20, superseding the version written on 2026-08-19 before v0.4. That file asked for
one thing above all - prove the engine on a real milestone - and it happened, so it is replaced
rather than edited.

## Where things stand

**The engine has been validated.** v0.4 was itself built as a four-milestone milestoner run
(`.milestoner/`, run `v04-plugin`): four fresh Claude Code sessions, each graded against its written
evidence, 23 evidence lines, every milestone `done` on its first attempt, no intervention. The
load-bearing assumption from D-006 - that a session writes `result.json` and the engine grades it -
held with a real agent.

What that run did not exercise, and is still unproven: a run long enough to hit a real usage limit
or agent fallback mid-flight, a non-Claude agent across a whole run rather than a single milestone,
and the supervisor loop against a live multi-milestone run rather than the one blocked run it has
been tried on.

Also closed since the last version of this file: `LICENSE`, CI on three operating systems, agent
support beyond Claude Code with quota fallback, an environment adapter for macOS and Linux, the
guide brought up to date, the local web panel, and Claude Code plugin packaging with a marketplace.

One prediction in the old file was wrong and is worth recording: it called `promptDelivery`
(`arg` / `stdin` / `file`) "the one real engine change" needed for other agents. It was not needed.
Codex takes its prompt as an argument like Claude Code does, and the argument template covered it
with no engine change at all. Do not build it until an agent actually demands it.

## 1. The Windows test suite is red, and has been for every recent commit

Done on 2026-08-20 as milestone M01 of the `v05-debt` run. 82 of 82 pass on Windows. Both root
causes were in the tests, neither in the engine:

- **Checkout line endings.** With no `.gitattributes`, git handed Windows a working tree with CRLF,
  and the tests that parse `---\n` frontmatter out of files on disk found `---\r\n` and concluded
  there was no frontmatter. Fixed by a `.gitattributes` pinning `* text=auto eol=lf`, plus
  normalisation in the parsers themselves, since a shipped `.md` can arrive from anywhere.
- **A Windows path used as an ESM specifier.** `lock.test.ts` wrote a child script importing
  `join(process.cwd(), "src", "state.ts")`. On POSIX an absolute path resolves; on Windows Node
  rejected it with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `D:` reads as a protocol, so every
  writer child exited 1. Fixed with `pathToFileURL(...).href`. The cross-process locking guarantee
  from D-022 is now verified on Windows rather than assumed: six concurrent writers, all exit 0, six
  evidence entries surviving, `rev` 6.

What is not yet closed: the CI run that proves Linux and macOS did not regress. The protocol for
that run forbids `git push`, so the session could only verify locally that the changes are a no-op
on an LF checkout. Push the branch and read the matrix.

## 2. Publish to npm - deliberately last

Wanted eventually, not now, and deprioritised on 2026-08-20 behind everything else here. The README
and the guide document `npm install -g milestoner`; nothing is published. Everything that should gate
a publish is already in place - LICENSE, CI, changelog, a `files` list verified by `npm pack`, a
`prepublishOnly` that typechecks, tests and builds. It is the only item with an external audience,
which is the argument for doing it once the rest has settled rather than before.

## 3. `kill` on macOS and Linux only reaches one process

Windows uses `taskkill /T /F` and kills the tree. Elsewhere the engine signals the child it spawned,
and the process is not spawned `detached`, so there is no group to signal. When the agent command is
a wrapper script that forks, the real session outlives the kill and playbook rule 4 quietly does
nothing. Fix: spawn `detached` on POSIX and signal the process group. Needs a test that spawns a
wrapper which forks, or it will regress unnoticed.

## 4. A registry of runs, and a panel that spans them

The registry half is done on 2026-08-20 as milestone M02 of the `v05-debt` run. Runners register
their project path, run name and pid in `~/.milestoner/runs.json` and deregister in the same step
that clears the pulse; `milestoner runs [--json]` lists every one of them from any directory, with
its milestone, progress and liveness verdict, and exits `2` when one is blocked or its runner is
gone. A killed runner's entry is kept and reported `gone` for a day rather than vanishing. Recorded
as D-025.

What is left is the panel across runs. One run's panel now comes up with its run - `milestoner run
--serve`, done on 2026-08-20 as milestone M04, recorded as D-027 - but that is still one directory.
`serve` shows only the directory it was started in, so a multi-run
view is a `serve` change now that the primitive it needs exists: a run picker across the registry,
and a decision about whether one process may act on a project it was not started in. That is a
security question (D-020's write surface is scoped to one project) and should be answered before the
screen is built.

## 5. Still unanswered: authoring flows in a UI

Carried over unchanged from the web UI evaluation. Milestone prompts are hand-written on purpose;
that is the deliberate friction and the stated difference from task-generating loops. A flow builder
would produce exactly the vague specs the evidence gate exists to catch.

There is a defensible version - a UI that shows an existing run's shape and edits ordering and
titles, with the prompt files staying hand-written text. If the goal is really authoring in a GUI,
that supersedes a decision in BRIEF.md and should be written down as one before any screen is built.

## Plans

Items 1, 3 and 4 are planned as v0.5 in [PLAN-v05.md](PLAN-v05.md), as three milestones in this
project's own format: the Windows suite (done), the run registry (done), and `kill` on POSIX. Item 5 is planned
separately in [PLAN-flow-authoring.md](PLAN-flow-authoring.md), because it is a decision first and
work only if the decision goes a particular way. Item 2 comes after both.
