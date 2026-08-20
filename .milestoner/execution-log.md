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
