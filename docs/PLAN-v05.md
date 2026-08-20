# Plan: v0.5 - pay down the debt the dogfood run exposed

Three pieces of work, written as milestones in this project's own format so they can become
`.milestoner/prompts/` directly. Covers items 1, 3 and 4 of [NEXT.md](NEXT.md).

**Publishing to npm is explicitly deferred to after v0.5.** It is wanted eventually, not now, and it
is the only item here that has an external audience.

Ordering: M01 first, because everything after it is verified by a suite that currently cannot be
trusted on this machine. Then the registry, which is the largest piece and the only new capability
rather than debt. The POSIX kill goes last, because it is the only milestone whose evidence has to
come from CI rather than from the machine the session runs on, and a slow feedback loop is the one
you want to hit with work already banked.

**Where this runs.** The development machine is Windows, with no WSL. That is ideal for M01 and
neutral for M02, and it is the constraint that shapes M03: a fix to process-group signalling on
macOS and Linux cannot be verified from here at all. The milestones below account for that
explicitly rather than assuming a session can check its own work.

A note on running this as a milestoner run: `.milestoner/state.json` currently holds the completed
`v04-plugin` record. Scaffolding v0.5 replaces it. That record is committed, so it survives in git
history, but it stops being readable with `milestoner status` the moment the new run is scaffolded.

---

## M01 - The test suite passes on Windows

### Objective

`npm test` passes on Windows, so CI is green on all seven matrix jobs and the project's own gate can
be trusted again. Nothing in `src/` changes: every failure is in how tests read files or address
modules, not in the engine.

### Context

- Six failures on a clean Windows checkout, five from one cause and one from another.
- Linux and macOS are green today and must stay green.
- Touches `.gitattributes` (new), `src/plugin-commands.test.ts`, `src/templates/skill.test.ts`,
  `src/lock.test.ts`, and possibly `scripts/gen-skill.mjs`.
- Out of scope: the engine, the runner, anything under `src/server/`.

### Tasks

1. Add `.gitattributes` pinning `* text=auto eol=lf` so the working tree is LF on every platform.
   Renormalise the tree in the same commit (`git add --renormalize .`), or the fix is invisible
   until each file is next touched.
2. Make the frontmatter parsing in `src/plugin-commands.test.ts` line-ending agnostic: normalise
   `\r\n` to `\n` before splitting on `---\n`. A shipped `.md` can arrive from anywhere, so the
   parser should not depend on how git checked it out.
3. Make the drift guard in `src/templates/skill.test.ts` compare normalised text, for the same
   reason. Decide explicitly whether `gen-skill.mjs` should also write LF regardless of platform;
   if so, say why in a comment.
4. In `src/lock.test.ts`, build the child script's import specifier with
   `pathToFileURL(...).href`. A bare absolute path is a valid specifier on POSIX and is rejected on
   Windows, where `D:` parses as a URL scheme, which is why every writer child exits 1 there.
5. Audit the other tests that read from disk for the same two assumptions:
   `src/version.test.ts`, `src/runner.once.test.ts`, `src/runner.stop.test.ts`,
   `src/server/http.test.ts`.

### Acceptance criteria

- **AC1** - `npm test` passes on Windows with 0 failures.
  (evidence: the summary lines `# pass` and `# fail` from a local Windows run, in
  `.milestoner/evidence/M01-test.txt`)
- **AC2** - Linux and macOS did not regress: the suite still passes there.
  (evidence: the CI run id for the closing commit and the conclusion of its Linux and macOS jobs)
- **AC3** - The cross-process locking guarantee from D-022 is actually verified on Windows: the
  concurrent-writers test runs its six children to completion there rather than failing to load
  them. (evidence: that test named in the passing output, plus the writer exit codes)
- **AC4** - No file under `src/` outside `*.test.ts` changed. (evidence: `git diff --stat` for the
  milestone's commits)

### Exit

- All acceptance criteria evidenced.
- Committed and tagged `v05/M01`.
- `.milestoner/result.json` written with `status: "done"` and one evidence line per criterion.

---

## M02 - A registry of runs, and `milestoner runs`

### Objective

Answer "what is running on this machine" from anywhere, not only from inside one project directory.
`serve` and `status` today only ever see the directory they were started in, because there is no
notion of the set of runs. This milestone builds that primitive and exposes it as a CLI command; a
panel that spans runs is deliberately left for later.

### Context

- Touches `src/paths.ts` (a machine-level path beside the per-project layout), a new registry
  module, `src/runner.ts` (register and deregister), `src/cli.ts`, and a new command.
- Reuse `withStateLock` from D-022: several runners will write the registry at once, and it is
  exactly the lost-update shape that lock already solves.
- Out of scope: the web panel, any cross-run view in `serve`, and anything that reaches across
  machines.

### Decisions to make inside this milestone, and record

- **What is registered: live runners, or projects that have a `.milestoner/`?** A registry of live
  runners is simpler and honest, but then a run whose runner died does not appear at all - which is
  precisely the state a person most wants to be told about. A `lastSeen` field and a retention
  window is the middle path. Pick one and write down why.
- **Where the file lives.** `~/.milestoner/runs.json` is the obvious answer; say whether XDG paths are
  honoured on Linux, and what happens when the home directory is not writable.
- **How stale entries die.** Pid liveness on read is the cheap answer, but pids are reused. Pair it
  with the project path and the run name so a recycled pid cannot masquerade as a live run.

### Tasks

1. Registry module: register, deregister, read-with-pruning. Serialised with `withStateLock`.
2. The runner registers on start and deregisters in the same `finally` that clears the pulse, so the
   two cannot disagree.
3. `milestoner runs [--json]`: every known run with its project path, run name, current milestone,
   done/total, and liveness verdict, read from each project's own `state.json` and `pulse.json`.
4. Handle a registered project whose `.milestoner/` has been deleted or renamed: prune it and say so,
   rather than failing the whole listing.
5. Tests: concurrent registration from several processes loses nothing; a dead runner's entry is
   pruned; a recycled pid is not mistaken for a live run; a deleted project does not break `runs`.

### Acceptance criteria

- **AC1** - Two runs started in different directories both appear in `milestoner runs`, each with the
  right milestone and liveness verdict. (evidence: the command's output for both, captured in
  `.milestoner/evidence/M02-runs.txt`)
- **AC2** - A runner that is killed leaves no live entry: the next `milestoner runs` prunes it.
  (evidence: the test name, plus before/after output)
- **AC3** - Concurrent registration from several processes loses no entry, on the same argument as
  D-022. (evidence: the test name and its assertion)
- **AC4** - A registered project whose directory is gone is pruned and reported, and does not fail
  the listing. (evidence: the test name)
- **AC5** - The three decisions above are recorded in `docs/DECISIONS.md`. (evidence: the decision
  number and heading)
- **AC6** - `docs/GUIDE.md` documents the command and drops "no view across runs" from its limits.
  (evidence: the section name and the amended limits list)

### Exit

- All acceptance criteria evidenced, suite green on three platforms.
- Committed and tagged `v05/M02`.
- `.milestoner/result.json` written with `status: "done"` and one evidence line per criterion.

---

## M03 - `kill` ends the whole session on every platform

### Objective

`milestoner kill` terminates the agent session and everything it spawned, on macOS and Linux as it
already does on Windows. Today the POSIX path signals only the child the engine spawned, so an agent
launched through a wrapper script survives the kill and playbook rule 4 silently does nothing.

### Context

- `src/commands/kill.ts` uses `taskkill /PID <pid> /T /F` on Windows and `process.kill(pid,
  "SIGTERM")` elsewhere. `src/session.ts` spawns without `detached`, so there is no process group to
  signal.
- The same asymmetry affects the runner's own abort path (`onAbort` in `runSession`), which is what
  the second interrupt uses. Fix both or the two paths disagree.
- **Design note that must be decided, not assumed:** `detached: true` on POSIX puts the child in its
  own process group, which also stops it from receiving the terminal's SIGINT. That is arguably
  correct - it makes the engine's explicit kill authoritative instead of relying on signal
  propagation - but it changes what a single Ctrl-C does to the child. The two-interrupt semantics
  from `runner.stop.test.ts` must still hold afterwards, and that is a gate, not a detail.
- Out of scope: Windows, which already kills the tree.
- **This milestone cannot verify itself on the development machine.** The fix is to POSIX process
  groups and the machine is Windows with no WSL, so the only POSIX runner available is CI. Work on a
  branch `v05/M03`, push, and read the result with `gh run watch`. Do not push to `main`.
- **Bound the loop.** Each push-and-wait cycle costs minutes, so a wrong assumption about process
  groups could burn a whole night at five minutes a turn. Allow at most four CI cycles for this
  milestone; on the fifth, report `blocked` with what the runs showed rather than continuing. This
  replaces the protocol's usual failure budget, which assumes fast local feedback.

### Tasks

1. Spawn the agent `detached: true` on POSIX, keeping stdio piped.
2. Signal the process group (`process.kill(-pid, ...)`) from both `kill.ts` and the runner's abort
   path, falling back to the bare pid if the group signal fails.
3. Escalate: `SIGTERM`, then `SIGKILL` after a short grace period, so a session that ignores the
   first signal does not leave the runner waiting forever.
4. Re-verify the interrupt semantics on POSIX after the change.
5. Write a test that spawns a wrapper which forks a grandchild, kills it through the same code path,
   and asserts the grandchild is gone. Without it this regresses unnoticed, which is how it got here.

### Acceptance criteria

- **AC1** - A wrapper script that forks a grandchild is fully terminated by the kill path on macOS
  or Linux; the grandchild's pid is no longer alive afterwards. The session cannot run this
  assertion locally, so the evidence is the CI job that did.
  (evidence: the CI run id, the Linux and macOS job conclusions, and the new test's name in their
  output, captured in `.milestoner/evidence/M03-ci.txt`)
- **AC2** - The two-interrupt semantics still hold: one interrupt finishes and grades the running
  session, a second kills it and leaves the milestone `in_progress` costing no attempt.
  (evidence: `runner.stop.test.ts` passing, both test names quoted)
- **AC3** - Windows behaviour is unchanged, verified locally and in CI.
  (evidence: the local Windows suite summary, plus the Windows CI job conclusion)
- **AC4** - The `detached` decision is recorded in `docs/DECISIONS.md` with what it changes about
  Ctrl-C, not left as an unexplained spawn flag. (evidence: the decision number and its heading)

### Exit

- All acceptance criteria evidenced, suite green on three platforms.
- Committed and tagged `v05/M03`.
- `.milestoner/result.json` written with `status: "done"` and one evidence line per criterion.

---

## Closing v0.5

- `CHANGELOG.md`: an `[0.5.0]` section, and the version bumped through `npm run sync:version`.
- `docs/NEXT.md`: rewritten around what is left, which by then is npm publication and the flow
  authoring decision.
- `README.md`: the roadmap gains v0.5, and the Windows CI caveat comes out.
