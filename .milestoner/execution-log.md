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
