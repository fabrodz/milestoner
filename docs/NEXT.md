# What to do next

Rewritten 2026-08-20, superseding the version written on 2026-08-19 before v0.4. That file asked for
one thing above all - prove the engine on a real milestone - and it happened, so it is replaced
rather than edited.

## Where things stand

**The engine has been validated.** v0.4 was itself built as a four-milestone dogwatch run
(`.dogwatch/`, run `v04-plugin`): four fresh Claude Code sessions, each graded against its written
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

The only thing here that is actually broken. CI is failing on `windows-latest` (Node 20 and 24)
while Linux and macOS are green, and it reproduces locally: 5 failures out of 82, 6 in a clean
checkout. Two root causes, neither in the engine:

- **Checkout line endings.** With no `.gitattributes`, git hands Windows a working tree with CRLF.
  Three tests parse `---\n` frontmatter out of files on disk (`commands/*.md`,
  `skills/dogwatch-supervisor/SKILL.md`), find `---\r\n`, and conclude there is no frontmatter.
  Five of the six failures are this. Fix: a `.gitattributes` pinning `* text=auto eol=lf`, and
  parsers that normalise line endings before splitting, since a file can arrive from anywhere.
- **A Windows path used as an ESM specifier.** `lock.test.ts` writes a child script that imports
  `join(process.cwd(), "src", "state.ts")`. On POSIX an absolute path resolves; on Windows Node
  rejects it with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `D:` reads as a protocol. Every writer
  child exits 1, so **the cross-process locking guarantee from D-022 has never actually been
  verified on Windows.** Fix: `pathToFileURL(...).href`.

Do this first. It is small, and the alternative is a project whose own gate is ignored - the exact
failure the evidence gate exists to prevent, one level up.

## 2. Publish to npm - deliberately last

Wanted eventually, not now, and deprioritised on 2026-08-20 behind everything else here. The README
and the guide document `npm install -g dogwatch`; nothing is published. Everything that should gate
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

`serve` and `status` only ever show the directory they were started in, because there is no notion
of "the runs on this machine". The missing primitive is a machine-level registry - runners
registering their project path and pid under something like `~/.dogwatch/runs.json`, pruning
themselves on exit.

Build it as a CLI command first (`dogwatch runs`, listing every live run with its milestone and
liveness verdict). It is useful on its own, and a multi-run panel without it can only show one
directory, which is what the panel already does.

## 5. Still unanswered: authoring flows in a UI

Carried over unchanged from the web UI evaluation. Milestone prompts are hand-written on purpose;
that is the deliberate friction and the stated difference from task-generating loops. A flow builder
would produce exactly the vague specs the evidence gate exists to catch.

There is a defensible version - a UI that shows an existing run's shape and edits ordering and
titles, with the prompt files staying hand-written text. If the goal is really authoring in a GUI,
that supersedes a decision in BRIEF.md and should be written down as one before any screen is built.

## Plans

Items 1, 3 and 4 are planned as v0.5 in [PLAN-v05.md](PLAN-v05.md), as three milestones in this
project's own format: the Windows suite, `kill` on POSIX, and the run registry. Item 5 is planned
separately in [PLAN-flow-authoring.md](PLAN-flow-authoring.md), because it is a decision first and
work only if the decision goes a particular way. Item 2 comes after both.
