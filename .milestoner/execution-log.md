# Execution log - run "v05-debt"

## M01 - The test suite passes on Windows (2026-08-20)

### What was built

- `.gitattributes`, new: `* text=auto eol=lf`, so the working tree is LF on every platform whatever
  `core.autocrlf` is set to locally. This machine had `core.autocrlf=true`, which is what produced
  the CRLF tree.
- `src/plugin-commands.test.ts`: `frontmatterOf` normalises `\r\n` to `\n` before splitting on
  `---\n`.
- `src/templates/skill.test.ts`: an `lf()` helper applied both to the frontmatter split and to the
  drift guard, which now compares text rather than bytes.
- `scripts/gen-skill.mjs`: writes `SKILL.md` as LF unconditionally, with the reason in a comment.
- `src/lock.test.ts`: the child writer's import specifier is built with `pathToFileURL(...).href`.
- The working tree was renormalised to LF outside `.milestoner/` (see decisions).
- Documentation the fix invalidated: `README.md` no longer says the Windows jobs are failing,
  `docs/GUIDE.md`'s limits section no longer lists the red suite, `docs/NEXT.md` item 1 is closed,
  `CHANGELOG.md` has the entry under `[Unreleased]`, and `docs/DECISIONS.md` gains D-024.

### Evidence per acceptance criterion

- **AC1** - `npm test` exits 0 on Windows: `# tests 82`, `# pass 82`, `# fail 0`, `# cancelled 0`,
  `# skipped 0`, zero `not ok` lines, in `.milestoner/evidence/M01-test.txt`. The baseline before
  any change is kept beside it in `M01-test-baseline.txt`: `# pass 79`, `# fail 3`.
- **AC2** - Not evidenced by CI, and this is the one gap in the milestone. AC2 asks for a CI run id;
  protocol section 5 forbids `git push`, so no CI run exists for the closing commit. Local evidence
  instead: the suite passes against a working tree that is now byte-identical to what a POSIX
  checkout produces (`git ls-files --eol -- ':!.milestoner'` reports `i/lf w/lf` for 99 of the 100
  files, the hundredth being empty), and every change is a verified no-op on LF input -
  `.milestoner/evidence/M01-posix-check.txt` shows `normalisation-is-identity=true` for all five
  files the touched tests read, and `pathToFileURL` producing `file:///...`, the specifier form Node
  accepts on every platform and a strict widening of the bare path POSIX already accepted. No WSL on
  this host, so a real Linux run was not available either. **User action: push and read the matrix.**
- **AC3** - `ok 15 - concurrent writers from separate processes do not lose an update` in
  `M01-test.txt` line 91, against `not ok 15 ... every writer must exit cleanly, actual [1]` at the
  same line in the baseline. The exit codes are captured directly in
  `.milestoner/evidence/M01-lock-writers.txt`: `platform: win32`, `writer exit codes:
  [0,0,0,0,0,0]`, `evidence entries surviving: 6 of 6`, `rev: 6`. D-022's cross-process locking
  guarantee is verified on Windows rather than skipped by a module load failure.
- **AC4** - `git diff --stat 5d22e25 8207e59` in `.milestoner/evidence/M01-diffstat.txt`: five files,
  `.gitattributes`, `scripts/gen-skill.mjs` and three `*.test.ts`. `git diff --name-only 5d22e25 HEAD
  -- src | grep -v '\.test\.ts$'` returns zero lines. The second commit is documentation and run
  files only.

### Gates

`node --version` v22.20.0. `claude plugin validate --help` exit 0. `npm run build` exit 0,
`npm run typecheck` exit 0, `npm test` exit 0, all re-run after the working tree was renormalised.
`git status` is clean apart from the engine's own `state.json` and its untracked run files.

### Problems hit

- **The failure count did not match the prompt.** M01 and `docs/NEXT.md` both said six failures; a
  clean local run showed three. The working tree was mixed, 75 files CRLF and 30 LF, and the two
  command files that passed are ones recent commits had left as LF. The root causes and the fixes
  were exactly as specified; only the count differed, and after the LF pin the distinction is moot.
- **`git checkout-index -f` does not rewrite an existing file.** It exits 0 and leaves the CRLF copy
  in place, so the tree stayed CRLF after the first attempt. Deleting the files first and then
  restoring them from the index works. Verified on `README.md` alone before doing it to 100 files.
- **`git status` then reported 68 files as modified with an empty `git diff`.** Stale stat data in
  the index: `git diff --quiet` returned 0 and `git show :README.md | cmp -` was identical, but
  `git update-index --really-refresh` refused with `needs update`. `git add --renormalize` rewrote
  the stat info and the tree went clean, staging nothing, which is itself the proof that no content
  changed.

### Decisions

Four, in `.milestoner/decisions.md`. One promoted to the permanent record as D-024 in
`docs/DECISIONS.md`: the repository is LF and the parsers do not trust it, with the reasoning for
doing both rather than either.

### Descoped

Nothing. The six tracked files under `.milestoner/` are still CRLF in the working tree, deliberately:
they are engine-owned while the run is live, their index content is LF, and nothing reads them for
their bytes. They normalise on the next checkout.

### Engine findings

None. Both root causes were in the tests, as the milestone predicted. The engine ran this session
normally throughout.

### Backlog

- `src/lock.test.ts` still derives the repository root from `process.cwd()`, which is only correct
  because `npm test` runs from the root. `import.meta.url` would be honest. Out of scope here.

### Next step

M02, the run registry and `milestoner runs`. Before that, someone should push and confirm the
Linux and macOS matrix jobs, which is the only part of M01 that cannot be checked from inside a
session.

## M02 - A registry of runs, and `milestoner runs` (2026-08-20)

### What was built

A machine-level registry of runs and the command that reads it, so "what is running on this machine"
has an answer from any directory.

- `src/registry.ts`, new: `registerRun`, `deregisterRun` and `listRuns`, all serialised with
  `withStateLock` from D-022 and all best-effort, so a read-only home directory costs a run its
  registry entry and nothing else. `listRuns` enriches every entry from that project's own
  `state.json` and `pulse.json`, and drops the entries that no longer describe anything.
- `src/paths.ts`: `machineDir()`, `registryPath()` and `samePath()`. The machine path is deliberately
  not part of `Layout`, which `paths.test.ts` asserts hangs entirely off the project directory name.
- `src/runner.ts`: registers on entry to the run loop, refreshes the entry inside the same closure
  that writes the pulse, and deregisters in the same `finally` that clears it, so the two can never
  disagree.
- `src/commands/runs.ts` and the `runs` branch in `src/cli.ts`, placed before `requireProject()`
  because answering from a directory that is not a project is the point of it.
- `verdictFor` and its thresholds moved from `commands/status.ts` into `pulse.ts`. `status` and
  `runs` now share one function rather than two copies of 15 and 25 minutes.

15 new tests in `src/registry.test.ts`, `src/commands/runs.test.ts` and
`src/runner.registry.test.ts`. Suite 82 -> 97.

### Evidence per acceptance criterion

- **AC1** - `.milestoner/evidence/M02-runs.txt`, section 1: two real runners started by `milestoner
  run` in two temp project directories, listed from a third directory that is not a project at all.
  `alive checkout-v2 M01 0/4 pid 40148 att 1` and `alive legacy-tests M01 0/3 pid 21408`, each with
  its own project path. Section 2 is the same listing as `--json`, with `runnerAlive: true`,
  `health: "alive"` and `lastEventSeconds: 6` for both. The script that produced it is beside it as
  `M02-demo.sh`. Test cover: `ok 32 - two runs in different directories are both listed, each with
  its own milestone and verdict` and `ok 7 - both runs are printed with their project, milestone,
  progress and verdict`.
- **AC2** - `ok 33 - a runner that is gone leaves no live entry, and expires out of the file a day
  later`. Before and after in `M02-runs.txt`: section 1 has `alive legacy-tests`, section 3 kills
  that runner's process tree with `taskkill /F /T` so it never reaches its `finally`, and the same
  command then prints `gone legacy-tests M01 0/3 pid 21408` with `the runner is not running;
  relaunch it with milestoner run in that directory - last seen 9s ago`, and `exit=2`.
- **AC3** - `ok 36 - concurrent registration from several processes loses no entry`. Six separate
  node processes, spawned together and awaited together, each registering its own project root. The
  assertions are that the set of exit codes is `[0]` and that the listed run names equal all six,
  which is the D-022 argument applied to this file: without the lock, six load-mutate-write cycles
  leave whoever renamed last holding a copy that never saw the other five.
- **AC4** - `ok 35 - a registered project whose directory is gone is pruned and reported, not fatal`
  and `ok 9 - a deleted project is reported as pruned and does not take the listing down with it`.
  Live in `M02-runs.txt` section 4: after `rm -rf` of the checkout-api project, the listing still
  prints the other run and adds `pruned checkout-v2 (...): its .milestoner directory is gone`.
  Section 5 shows it is reported once and then dropped from the file, and prints the file to prove
  it.
- **AC5** - `D-025 - A machine-level registry of runs, behind milestoner runs (2026-08-20)` in
  `docs/DECISIONS.md`, with a paragraph per required decision: live runners plus a 24-hour retention
  window; `~/.milestoner/runs.json` with a `MILESTONER_HOME` override, no XDG, and best-effort writes
  when the home directory is not writable; and pid liveness corroborated by the project's own
  `pulse.json` naming that pid and that run, with the residual hole named rather than hidden.
- **AC6** - `### milestoner runs` in `docs/GUIDE.md`, between `milestoner status` and `milestoner
  unblock`: the invocation, sample output, the verdict table, the exit-code contract, the registry
  file and `MILESTONER_HOME`, and the note that there is still no panel across runs. The limits list
  now reads `**One run per project directory.** Runs across the machine are listed by [milestoner
  runs](#milestoner-runs) ... but there is still no *panel* across them`, replacing `**One run per
  project directory**, and no view across runs. There is no registry of the runs on a machine`.

### Gates

`node --version` v22.20.0. `claude plugin validate --help` exit 0, and `claude plugin validate .`
passes. `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` exit 0:
`.milestoner/evidence/M02-test.txt` reports `# tests 97`, `# pass 97`, `# fail 0`, `# cancelled 0`,
`# skipped 0`, zero `not ok` lines. The pre-change baseline is beside it in `M02-test-baseline.txt`
at 82/82.

The milestone's exit line asks for the suite green on three platforms. Only Windows can be shown
from here, for the reason M01 recorded: protocol section 5 forbids `git push`, so no CI run exists.
The new code was written against that constraint - `samePath` is case-insensitive except on Linux,
the child process in `registry.test.ts` builds its import specifier with `pathToFileURL`, and
`commands/runs.test.ts` strips ANSI before matching so the assertions do not depend on whether
stdout is a tty. Push and read the matrix.

### Problems hit

- **The first demo script launched two real Claude sessions.** It rewrote each temp project's
  `config.json` with a stub agent through `node -e`, but git-bash handed node a `/tmp/...` path,
  which node resolved against the current drive as `D:\tmp\...`. The rewrite failed, `milestoner run`
  used the default `claude` command, and two unsandboxed sessions started in temp directories. Killed
  with `taskkill /F /T` within a minute, no other project touched. The script now converts with
  `cygpath -m` and asserts the stub agent is installed before launching anything.
- **`rm -rf` of a live project fails on Windows.** The runner's working directory holds the
  directory open, so the AC4 demo kills the runner's tree first and then deletes.
- **`listRuns` wrote the pruned list back wholesale at first**, which would discard a runner that
  registered between the read and the write. It now re-filters under the lock by project path and
  pid.

### Decisions

Four in `.milestoner/decisions.md`. The first promotes the three the milestone named to `D-025` in
the permanent record. The other three are engine-level: the liveness verdict in `runs` reads the
pulse's last event rather than walking each project's watched paths; `runs` exits 2 for a gone
runner as well as a blocked run; registry writes are swallowed rather than raised.

### Descoped

Nothing. Out of scope and left alone as the milestone says: the web panel, any cross-run view in
`serve`, anything across machines.

### Engine findings

None from a gate. One observation: this repository's own live run does not appear in `milestoner
runs`, because the runner supervising this session loaded `dist/cli.js` before the registry existed.
Expected under protocol section 7, and it resolves itself on the next `milestoner run`.

### Backlog

- A `/milestoner-runs` slash command. It passes D-018's test - worth running without leaving the
  session, not long-lived, not a human-only decision - but shipping it means amending D-018 and its
  test, which is not this milestone's scope.
- `milestoner serve` could offer a run picker across the registry. That needs an answer first on
  whether one panel process may act on a project it was not started in; D-020 scoped its write
  surface to one project deliberately.
- `.milestoner/run-log.md` is still untracked, as M01 left it. The engine appends to it while a
  session is alive, so committing it captures a half-written snapshot. Worth deciding once rather
  than leaving each session to decide again.

### Next step

M03, `kill` ending the whole session on every platform. Its own prompt warns that a POSIX
process-group fix cannot be verified from this Windows host; read that before starting. The CI push
that M01 and M02 both need is still outstanding.

## M03 - `kill` ends the whole session on every platform (2026-08-20)

Attempt 1 did the work and drove CI green on all eight jobs, then died with a 15-byte "Execution
error" transcript before writing `result.json`, so the engine graded it incomplete. Its code landed
as 57850f5 and its evidence files were banked by cb3fe25. This session re-ran every gate against
that commit, closed the one gap in the CI evidence, and closed the milestone. No second CI cycle was
needed, so one of the four the prompt allows was spent.

### What was built

The session's process tree, rather than the one process the engine spawned, is what both kill paths
now signal.

- `src/session.ts`: `terminateSessionTree(pid, signal)` signals `-pid` on POSIX - the process group
  the session leads, because `runSession` now spawns it `detached: true` - and falls back to the bare
  pid if the group signal throws. Windows keeps `taskkill /PID <pid> /T /F`. `killSessionTree(pid,
  graceMs)` wraps it with the escalation: SIGTERM, poll for exit, SIGKILL after `KILL_GRACE_MS` of
  five seconds. The escalation timer is `unref`'d and cleared in `finish()`, so a pid that has
  already exited cannot be signalled again after the number is recycled.
- `src/commands/kill.ts` calls `killSessionTree` instead of `process.kill`, and takes a `graceMs`
  the tests shorten.
- The runner's abort path, `onAbort` in `runSession`, calls the same function. It previously ended
  the `cmd` shim alone on Windows too, so the two paths disagreed on both platforms, not just POSIX.
- `src/server/api.ts`, `src/server/http.ts` and `src/cli.ts` follow the now-async `kill`.

3 new tests in `src/session.kill.test.ts`. Suite 97 -> 100.

### Evidence per acceptance criterion

- **AC1** - `.milestoner/evidence/M03-ci.txt`. Run id `32383755761` on branch `v05/M03` at sha
  57850f5, event `pull_request` (#1), verdict `success`, with all eight job conclusions listed. The
  appended section quotes the job logs themselves: `ok 76 - a wrapper's grandchild is killed with the
  session, not orphaned`, `ok 77 - the runner's abort takes the grandchild with it too` and `ok 78 -
  a session that ignores SIGTERM is killed after the grace period`, in `ubuntu-latest / node 20` (job
  96473048188) and `macos-latest / node 20` (job 96473048454), both at `# pass 100`, `# fail 0`. Test
  76 spawns a wrapper that forks a grandchild, records the grandchild's pid to a file, writes a real
  `pulse.json` and goes through `kill()` itself, then asserts `isProcessAlive(grandchild) === false`.
- **AC2** - `ok 58 - one interrupt lets the running session finish and be graded, then stops` and
  `ok 59 - a second interrupt kills the session and leaves the milestone in_progress`, from
  `src/runner.stop.test.ts`. Passing locally in `.milestoner/evidence/M03-test.txt` and, more to the
  point for a `detached` change, on both POSIX runners in `M03-ci.txt`.
- **AC3** - Local Windows suite `.milestoner/evidence/M03-test.txt`: `# tests 100`, `# pass 100`,
  `# fail 0`, `# cancelled 0`, `# skipped 0`, zero `not ok` lines. CI `windows-latest / node 20`
  (job 96473048237) and `node 24` (job 96473048107) both `success`, with tests 58, 59 and 76-78
  quoted in `M03-ci.txt`. `.milestoner/evidence/M03-negative-windows.txt` is the kill file run on
  its own from attempt 1. Windows code is untouched apart from the abort path now reaching the tree.
- **AC4** - `docs/DECISIONS.md`, `## D-026 - The agent session gets its own process group, and the
  kill escalates (2026-08-20)`. It states the cost in its own paragraph: a detached child leaves the
  terminal's foreground process group, so Ctrl-C in the terminal running `milestoner run` reaches
  the runner and nothing else, where before the tty delivered SIGINT straight to the agent and
  usually killed it on the first press - which quietly broke the two-interrupt contract on POSIX.
  Rejected alternative recorded: walking the process table for children of the pid.

Gate: `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` exit 0, `claude plugin validate
.` exit 0. Suite 100/100 on Windows locally and on all three platforms in CI.

### Problems hit

Only one, and it was attempt 1's: `on: push` in the workflow is scoped to `main`, so pushing the
branch produced no run at all. Opening a pull request was the fix, recorded as a decision rather
than widening the trigger to every branch.

### Decisions

Three in `.milestoner/decisions.md`, one promoted to `docs/DECISIONS.md` as D-026. The other two:
CI is reached through a pull request rather than by widening the push trigger, and the runner's
Windows abort path now uses the same tree kill as `kill` rather than staying on `child.kill`.

### Descoped

Nothing.

### Engine findings

The runner's abort path was broken on Windows as well, not only on POSIX as the prompt assumed: it
called `child.kill("SIGTERM")` on the `cmd` shim, which ends the shim and leaves the agent behind
exactly as the POSIX case did. Found while making the two paths agree, fixed in the same commit.

### Backlog

- `.milestoner/run-log.md` is now tracked but the engine appends to it while a session is alive, so
  every session commits a half-written snapshot of its own run. Still worth deciding once.
- The workflow only runs on `main` and on pull requests. A run whose milestones each need CI will
  open a pull request per milestone; a `workflow_dispatch` trigger would be cheaper.

### Next step

M04, the panel coming up with the run (`--serve` on `milestoner run`). Nothing from M03 blocks it.

## M04 - The panel comes up with the run (2026-08-20)

`milestoner run --serve` brings the web panel up with the run. One session, no gate failures, no
descoping.

### What was built

- `src/server/panel.ts`, new. `startPanel()` builds the panel, listens on `127.0.0.1`, and hands back
  a URL, the bound port, the `http.Server` and a `close()` that also calls `closeAllConnections()` -
  without that an open server-sent-events stream holds the port after `close()` resolves.
  `announcePanel()` is the banner both callers print, differing only in its last line.
  `startRunPanel()` is the run's wrapper: `allowStart: false`, ephemeral-port fallback, and every
  failure a warning rather than an exit code.
- `src/commands/serve.ts` is now that lifecycle plus its own SIGINT/SIGTERM handling. Its output,
  flags and read-only default are unchanged, including the `pick another with --port` failure.
- `src/server/http.ts` takes `allowStart`. The state view gained `canStart`, sent on `/api/state` and
  over the event stream through one `view()` so the two cannot drift, and `/api/run/start` answers
  409 when the panel came up with a run. `src/server/page.ts` draws the start button off `canStart`.
- `src/runner.ts` takes `serve?: { port, write, token }`, starts the panel after registering and
  before the first session, and closes it in the same `finally` that clears the pulse and
  deregisters the run.
- `src/cli.ts` adds `--serve` to `run`, reusing `--port` and `--write`, with the port validation
  shared with `serve`. `--open` alongside `--serve` exits 1 with the reason.

6 new tests, 5 in `src/runner.serve.test.ts` and 1 in `src/server/http.test.ts`. Suite 100 -> 106.

### Evidence per acceptance criterion

- **AC1** - `ok 58 - the panel comes up with the run and answers with this run's live state`. The
  captured request and response are in `.milestoner/evidence/M04-serve.txt` section 1: a real
  `milestoner run --serve --port 1640` against `dist/cli.js`, its banner, then
  `GET /api/state?token=...` answering `200` with `"run": "panel-demo"`, `M01` `in_progress`, and a
  pulse whose `pid` is that runner, `runnerAlive: true`, `agentAlive: true`. The run then drained to
  `RUN COMPLETE` with M01 `done`.
- **AC2** - `ok 59 - the panel is closed once the run ends, and its port is free again`, which
  asserts `fetch` rejects after `run()` resolves and that a fresh server can bind the same port.
  Section 2 of `M04-serve.txt` is the same thing end to end: `connection refused: ECONNREFUSED` and
  `port 1640 bindable again: yes` after `runner exit code: 0`.
- **AC3** - `ok 63 - one interrupt lets the running session finish and be graded, then stops` and
  `ok 64 - a second interrupt kills the session and leaves the milestone in_progress` still pass
  untouched. The attached-panel cases are `ok 61 - one interrupt with a panel attached still finishes
  and grades the running session` (M01 `done` with its evidence, M02 still `pending`) and `ok 62 - a
  second interrupt with a panel attached still leaves the milestone in_progress` (`attempts` 0, no
  history entry); both also assert the panel closed with the run. No SIGINT handler is installed from
  the panel path.
- **AC4** - `ok 60 - a port already in use moves the panel and does not take the run down`, which
  asserts the printed line `port <n> is already in use - the panel is on port ` and that the panel
  which did come up answers for this run. Section 3 of `M04-serve.txt` has it against the real CLI:
  `port 4400 is already in use - the panel is on port 1557 instead`, then the run completing with M01
  `done`.
- **AC5** - `milestoner serve` is covered by `ok 67..77` in `src/server/http.test.ts`, unchanged and
  passing, including `ok 73 - a read-only panel refuses every write and says so in its state`.
  Section 5 of `M04-serve.txt` shows the real command's read-only banner, its read-write banner with
  both warning lines, and `port 4400 is already in use - pick another with --port` with exit code 1.
- **AC6** - `docs/DECISIONS.md`, `## D-027 - The panel comes up with the run, and what that costs
  (2026-08-20)`, one paragraph per decision. `README.md`: the `run` row of the command table now
  carries `[--serve]`, and `## The web panel` opens on both commands and has a paragraph on the three
  differences and the absent `--open`. `docs/GUIDE.md`: a new `#### Watching it in a browser:
  --serve` under `### milestoner run` with the difference table, a pointer to it from `### milestoner
  serve` and from quickstart step 6, and the `## Limits of v0.4` entry on one panel per directory
  updated. `CHANGELOG.md` under `## [Unreleased] / ### Added`.

Gate: `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` exit 0,
`claude plugin validate .` exit 0, `node --version` v22.20.0. `.milestoner/evidence/M04-test.txt`
reports `# tests 106`, `# pass 106`, `# fail 0`, `# cancelled 0`, `# skipped 0`, zero `not ok` lines,
against the 100/100 baseline M03 left.

### Problems hit

Two, both small. `server.close()` alone leaves the port held while an event-stream socket is open, so
the panel would have outlived the run by however long a browser kept its connection;
`closeAllConnections()` in the same close is the fix and AC2's port-rebind assertion is the gate on
it. And the first `--open` refusal named "the URL below" in a message printed instead of a URL, which
was reworded before the evidence was captured.

### Decisions

Three in `.milestoner/decisions.md`; the first two promoted to `docs/DECISIONS.md` as D-027 together
with the `--open` question the milestone posed. The third closes a backlog item carried since M02:
`state.json` and `run-log.md` stay out of the session's commits, staged explicitly rather than with
`git commit -a`, because the engine is appending to both while the session is alive.

### Descoped

Nothing.

### Engine findings

None from a gate. One observation: `startRun` in `src/server/api.ts` already refused to launch a
second runner when a live pulse named one, so the write-surface hazard this milestone was asked about
was half-closed by accident. It is a race - the pulse is written after the panel starts - and its
message explains the wrong thing. `allowStart` makes the refusal deliberate and leaves the pulse
check as the guard for the case it was written for: a panel started with `serve` beside a run.

### Backlog

- A panel across runs, still item 4 of `docs/NEXT.md`, still gated on whether one panel process may
  act on a project it was not started in. `canStart` is a small precedent for per-panel capability
  that a multi-run panel will want more of.
- `.gitignore` for `.milestoner/state.json` and `.milestoner/run-log.md`, with `git rm --cached`.
  Decided against doing it inside this milestone; it is the right end state and should be its own
  change.
- The workflow still runs only on `main` and on pull requests, so a milestone needing CI opens a pull
  request. `workflow_dispatch` would be cheaper. Carried from M03.

### Next step

The run's four milestones are complete. Outstanding across the run: push and read the CI matrix for
M01, M02 and M04, none of which have been through CI on Linux or macOS. Nothing in M04 is
platform-specific beyond what `serve` already did, but the two new port-binding tests are the kind
that behave differently on a loaded CI runner.

## M05 - The state lock cannot be broken by the process that just took it (2026-08-20)

The fix, the regression tests and the docs are complete and green locally; the milestone is
**blocked on AC3 alone**, because GitHub Actions refuses to start any job on this account.

### What was built

`src/lock.ts` rewritten around three changes, recorded together as D-028:

- **Acquisition publishes the payload atomically.** The holder JSON goes into a per-process temp
  file and `linkSync(tmp, lockfile)` makes it the lock: the link lands whole or fails `EEXIST`, so
  no contender can observe an empty lock. A filesystem without hard links (first non-EEXIST link
  error) drops the process to the old `wx`-then-write for good, where the grace below covers the
  reopened window. `at` is built per attempt, so a long wait cannot make a fresh acquisition look
  stale.
- **`breakIfStale` honours what it cannot read.** An unreadable or empty lock is broken only when
  the file's own mtime is older than a 3-second grace - the filesystem is the only party that saw
  the file appear, so no contender has to remember anything across processes. 3s not 300ms because
  FAT-family filesystems round mtime to whole seconds and FAT is exactly where the `wx` fallback
  runs. Readable holders keep the old rules: dead pid broken at once, `at` older than 30s broken.
- **The 5-second steal-and-run-unlocked fallback is gone.** Liveness now comes from the stale rules;
  the deadline is 60s, unreachable through any nameable failure, and on that path the caller
  proceeds unlocked but leaves the lock file alone, because deleting it is what let a third process
  in. Release is ownership-checked (exact payload compare), so a holder broken as stale cannot
  delete the lock its breaker has since taken.

5 new tests in `src/lock.test.ts`; the two concurrent tests hardened (6 writers x 5 writes, 6
registrars x 4 registrations). Suite 106 -> 111.

### Evidence per acceptance criterion

- **AC1** - `.milestoner/evidence/M05-lock.txt`. Pre-fix run (src/lock.ts from cf4fa0c, one word
  `export` added so the import resolves, stated in the file): exit 1, `# pass 8` / `# fail 3` -
  `not ok 5 - an empty lock is a lock acquired this instant, and a contender must not break it`
  ("must survive a contender"), `not ok 7 - a contender that meets an empty lock waits out the
  grace instead of stealing it` ("waited 22ms"), `not ok 8 - release removes only its own lock,
  never one that was broken and retaken` (lock already deleted). Post-fix run: exit 0, `# pass 11`
  / `# fail 0`. Test 5 drives the window exactly as the prompt describes: open `wx`, run
  `breakIfStale` from the contender's position, assert the lock survives and a third `wx` fails.
- **AC2** - `.milestoner/evidence/M05-repeats.txt`: 10 rounds of
  `node --import tsx --test src/lock.test.ts src/registry.test.ts`, every round exit 0, `# pass 20`
  / `# fail 0`, zero `not ok` lines. The rounds include `concurrent writers from separate processes
  do not lose an update` (now 30 interleaved acquisitions) and `concurrent registration from
  several processes loses no entry` (now 24). Full suite in `.milestoner/evidence/M05-test.txt`:
  `# tests 111`, `# pass 111`, `# fail 0` against the 106/106 baseline in `M05-test-baseline.txt`.
- **AC3** - **Not achieved**, `.milestoner/evidence/M05-ci.txt`. Run 32423986143 on wip/M05 at
  9621f63 (PR #3): all eight jobs `failure` with zero steps, annotation "The job was not started
  because recent account payments have failed or your spending limit needs to be increased", twice
  (initial + `gh run rerun`). The prompt's premise "the repository is public now, so Actions
  minutes are free" is false: `gh repo view` reports `visibility: PRIVATE`. No WSL, no Docker on
  this host. This is the blocker.
- **AC4** - `docs/DECISIONS.md`, `## D-028 - The lock carries its holder from the first instant,
  because D-022 broke empty locks on sight (2026-08-20)`. Opens on what D-022 got wrong (`wx`
  creates the lock empty, and "unreadable or empty" was deleted on sight - reasoning inverted),
  then one paragraph per decision with rejected alternatives.
- **AC5** - `CHANGELOG.md` under `## [Unreleased]` / `### Fixed`, first line: "Two milestoner
  processes writing state at the same moment could silently lose one of the writes". Symptoms
  named as a person sees them: an `unblock` that vanishes as if never typed, a live run missing
  from `milestoner runs`.

Gate: `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` exit 0 (111/111),
`claude plugin validate .` exit 0, `node dist/cli.js --version` prints 0.5.0. `dist/` left built
and green.

### Problems hit

GitHub Actions would not start a single job: every job in run 32423986143 fails instantly with a
billing annotation, on both the initial trigger and a rerun. The repository turned out to be
private, contradicting the prompt. With no WSL and no Docker on this host there is no local Linux
substitute, so AC3 - a core criterion, explicitly not descopeable - cannot be evidenced from here.
Everything else was done first, so the retry only needs a green matrix.

### Decisions

Three in `.milestoner/decisions.md`: the three lock decisions promoted to D-028; `breakIfStale`
exported so the regression test can drive the window deterministically (rejected: a test-only
grace knob, and child-process choreography whose spawn latency is the same order as any affordable
grace); and the pre-fix evidence run modifying the old lock by exactly one word, stated in the
evidence file.

### Descoped

Nothing.

### Engine findings

None from the engine itself. One finding about the run's scaffolding: the milestone prompt asserts
the repository is public and it is not, and the two cheap confirmations (visibility, one rerun)
were worth more than spending the remaining push-and-wait cycles on identical billing failures.

### Backlog

- The `wx` fallback path in `tryAcquire` is exercised only implicitly (no CI filesystem lacks hard
  links). A test that forces `linkUnsupported` would close that.
- `workflow_dispatch` on the CI workflow, carried from M03 and M04: still true, and this milestone
  would have used it.

### Next step

For the retry session, once the user has fixed GitHub billing or made the repository public: the
branch wip/M05 at 9621f63 holds everything, PR #3 is open; `gh run rerun 32423986143` (or an empty
push to wip/M05), `gh run watch`, write the ubuntu conclusions into
`.milestoner/evidence/M05-ci.txt`, then merge wip/M05 to main locally (no push to main), tag
`v05/M05`, and report done. The working tree is left checked out on wip/M05.

## M06 - A crashed agent does not cost the milestone an attempt (2026-08-20)

One session, no gate failures, no descoping. The classifier that misgraded M03 of this run now
refunds that exact shape.

### What was built

- `classifyInfraFailure` in `src/session.ts` restructured: the duration bound now encloses only the
  rules it was written for (usage-limit patterns, `infraFailurePatterns`, the 500-byte
  instant-death), and a new final branch classifies any transcript below
  `infra.crashTranscriptBytes` with no `result.json` as a `crash`, whatever the duration. Within
  `deathSeconds` every input reaches the old branches first, so nothing under ninety seconds
  changes reason or wait.
- `infra.crashTranscriptBytes`, new config key, default 100. Type in `src/types.ts`, default in
  `src/config.ts`; `loadConfig`'s merge fills it for configs that do not name it, asserted in the
  existing partial-config test. `init` serialises `defaultConfig`, so new scaffolds carry it.
- `InfraVerdict.reason` gained `"crash"`, and the panel's event feed labels `infra:crash` as "The
  session crashed mid-run". The report needed no change: it colours on the `infra-failure` outcome.
- 3 new tests in `src/session.test.ts`. Suite 111 -> 114.

### Evidence per acceptance criterion

- **AC1** - `ok 95 - an agent that crashed after fifteen minutes of work does not cost the
  milestone an attempt` in `.milestoner/evidence/M06-test.txt`, fed the M03 shape verbatim:
  929 seconds, 15 bytes, text `Execution error`, no `result.json`. Asserts reason `crash`, the
  generic wait, and a detail naming `929s` and `15-byte`. The exit code is absent from
  `InfraInput` by design - the verdict never comes from it - and the test says so.
- **AC2** - all pre-existing classification tests pass byte-identical: `ok 90` (instant death),
  `ok 91`, `ok 92`, `ok 99` (usage limits and reset parsing), `ok 98` (`infraFailurePatterns`),
  `ok 93` (`wroteResult` wins), and the two charged cases `ok 94` (120 B at 4000 s stays null,
  which is what pins the crash line below the old tiny threshold) and `ok 100` (90 KB of real work
  stays null whatever its text says). Suite `# tests 114`, `# pass 114`, `# fail 0` against the
  111/111 baseline in `M06-test-baseline.txt`.
- **AC3** - `ok 96 - one byte under the crash line is a crash, however long the session ran`
  (99 B at 4000 s, `crash`) and `ok 97 - at the crash line the transcript counts as work and the
  attempt is charged` (100 B at 4000 s, null). Both read the boundary from the config key, not a
  literal.
- **AC4** - `docs/DECISIONS.md`, `## D-029 - A transcript with nothing in it is a crash at any
  duration (2026-08-20)`: one paragraph per decision - the second lower threshold rather than a
  dropped bound, no refund above the line, and `infra.maxRetries` as the ceiling - each with its
  rejected alternative.
- **AC5** - the `## Limits of v0.5` bullet "A crashed session can still cost an attempt" is
  removed from `docs/GUIDE.md`; the infrastructure-failures section now lists the three shapes
  with the crash rule and its any-duration wording, the grading table gained the crash row, and
  the config reference documents `crashTranscriptBytes`. `CHANGELOG.md` under `## [Unreleased]` /
  `### Fixed`, first line: "A session that crashed mid-run no longer costs the milestone an
  attempt."

Gate: `npm run typecheck` exit 0, `npm test` exit 0 (114/114), `npm run build` exit 0,
`claude plugin validate .` exit 0, `node dist/cli.js --version` prints 0.5.0. CI not run: the
repository is private and Actions minutes are exhausted (M05's blocker), the prompt says not to
push, and everything here is platform-neutral logic the local Windows suite covers completely.
`dist/` left built and green.

### Problems hit

None. The one design point needing care was branch order: the crash check must come after the
in-window branches, or a sub-100-byte transcript announcing a usage limit inside ninety seconds
would be labelled `crash` and lose its announced-reset wait; `ok 92` guards exactly that.

### Decisions

Three in `.milestoner/decisions.md`: the three prompt-mandated decisions promoted to D-029; the
refund getting its own `crash` reason rather than a stretched `instant-death`; and the threshold as
a config key rather than a derived fraction of `tinyTranscriptBytes`.

### Descoped

Nothing.

### Engine findings

None. `README.md`, `docs/NEXT.md` item 1 and the roadmap paragraph were updated in the same
milestone because all three described the misgrading as current behaviour.

### Backlog

- Past `deathSeconds`, a sub-100-byte transcript that announces a usage limit is refunded as
  `crash` with the short generic wait, not as `usage-limit` with the announced-reset wait. Both
  refund, so only the wait length differs; not worth a fourth branch until an agent actually
  produces that shape.
- `workflow_dispatch` on the CI workflow, carried from M03, M04 and M05.

### Next step

M07, scaffolding a new run over an existing `.milestoner/` must not keep the previous run's
protocol. Nothing from M06 blocks it.
