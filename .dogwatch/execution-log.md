# Execution log - v04-plugin

## M01 - Plugin manifest and the supervisor skill as a plugin component (2026-08-19)

**Built.** The repository is now a valid Claude Code plugin with a second distribution channel
beside npm, without touching the CLI.

- `.claude-plugin/plugin.json` at the repo root: `name` dogwatch, `version` 0.3.0 (matches
  `package.json`), a user-facing `description`, `author` `{ name: "Fabian R." }`, `license` MIT,
  `keywords` (the package set plus `supervisor`), and `homepage`/`repository` strings. The strict
  validator accepts both optional fields.
- `skills/dogwatch-supervisor/SKILL.md`, generated from `SKILL_TEMPLATE` by `scripts/gen-skill.mjs`.
  New npm script `gen:skill`, wired into `build` (`npm run gen:skill && tsup`) so it regenerates on
  every build rather than being a manual step.
- Drift guard: new test "the plugin ships the same skill text the CLI writes" in
  `src/templates/skill.test.ts` reads the shipped file and asserts byte-equality with
  `SKILL_TEMPLATE`.

**Evidence per acceptance criterion.**

- AC1 - `claude plugin validate . --strict` exits 0. Captured in
  `.dogwatch/evidence/M01-validate.txt` ("Validation passed", exit 0), run after the skill
  component existed.
- AC2 - `diff <(dogwatch skill install --print) skills/dogwatch-supervisor/SKILL.md` produces no
  output, exit 0. Captured in `.dogwatch/evidence/M01-skill-diff.txt` (0 bytes).
- AC3 - Drift test present and genuinely fails on divergence. Deliberate-break check: appended
  `<!-- deliberate drift -->` to the shipped SKILL.md, ran the test file -> `not ok 4 ... # fail 1`;
  ran `npm run gen:skill` to restore -> `ok 4 ... # fail 0`. Test count 76 pass in
  `.dogwatch/evidence/M01-test.txt`.
- AC4 - `plugin.json` version "0.3.0" equals `package.json` version "0.3.0" (node compare printed
  MATCH).
- AC5 - `npm run typecheck` exit 0, `npm test` exit 0 (76 pass, 0 fail), `npm run build` exit 0.

**Problems hit.** None. Environment gate green on entry (Node v20.10.0, build 0, 75 tests passing);
`claude plugin validate --help` exit 0.

**Decisions.** Three run-local (`.dogwatch/decisions.md`): plugin version stays 0.3.0 (bump is
M04's), plugin files stay out of the npm tarball (`npm pack --dry-run` = 4 files, verified), author
name from LICENSE. One permanent: `docs/DECISIONS.md` D-017, the skill ships twice from one source,
superseding D-010's "for now".

**Descoped.** README `## Layout` section documents only the `.dogwatch/` tree, not repository
layout, so per task 5 it is left untouched; install/layout README work belongs to M03.

**Next step.** M02 - slash commands as plugin components.
