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

## M02 - Slash commands as plugin components (2026-08-19)

**Built.** The plugin now exposes four slash commands under `commands/`, each a prompt in the
register of the supervisor skill telling the session what to read, what to run, and what to report.

- `/dogwatch-init` - scaffold a run and walk the user through authoring the prompts.
- `/dogwatch-status` - read-only read of the run and its pulse.
- `/dogwatch-supervise` - one supervision cycle, invoking the `dogwatch-supervisor` skill rather
  than duplicating its playbook.
- `/dogwatch-report` - write the single-file HTML report and open it (read-only).

They are static markdown files, not generated from a template: unlike the skill (which ships twice),
commands ship only as plugin components, so there is no second copy to drift against and no `gen:`
script is warranted (`.dogwatch/decisions.md`).

**Command set - the judgement M02 is about.** Rejected, recorded in `docs/DECISIONS.md` D-018:
`run` and `serve` are long-lived processes that must survive the session, so a slash wrapper would
die with the conversation; `unblock` and `steer` are human-only decisions the supervisor is
forbidden to take, so no command spells them as a runnable invocation; `kill` and `attend` are
supervisor interventions reached through the `/dogwatch-supervise` cycle; `skill install` is
redundant because the plugin already carries the skill (D-017).

**Hard rules intact.** No command hands a model a path to `state.json`, `unblock` or `steer` that the
supervisor denies. `state.json` appears only inside a guard; the two human-only commands never appear
as runnable invocations. `src/plugin-commands.test.ts` asserts both.

**Evidence per acceptance criterion.**

- AC1 - `claude plugin validate . --strict` exits 0 ("Validation passed") with the four commands
  present, in `.dogwatch/evidence/M02-validate.txt`. First run failed on unquoted `argument-hint`
  YAML in two files; quoting fixed it.
- AC2 - `claude --plugin-dir . plugin details dogwatch` (exit 0) lists all four commands by name in
  its component inventory, in `.dogwatch/evidence/M02-details.txt`. Bare `claude plugin details`
  needs an installed plugin; loading the repo from disk with the top-level `--plugin-dir` is the
  closest inventory command that works here.
- AC3 - `src/plugin-commands.test.ts`: one subtest per command asserting presence + `description`
  frontmatter, plus "no command hands the model a path the supervisor is denied". Deliberate break
  (removed `dogwatch-report.md`) gave `not ok 25 ... 'commands/dogwatch-report.md is missing'`,
  `# fail 2`; restore gave `# pass 81 # fail 0`. Names and counts in `.dogwatch/evidence/M02-test.txt`.
- AC4 - `docs/DECISIONS.md` D-018 "Four slash commands ship; run, serve, and the human-only commands
  do not (2026-08-19)" names the four shipped and each rejected command with its reason.
- AC5 - `npm run typecheck` exit 0, `npm test` exit 0 (81 pass, 0 fail, up from 76), `npm run build`
  exit 0. Counts in `.dogwatch/evidence/M02-test.txt`.

**Problems hit.** `argument-hint: [...]` is invalid YAML (bracket = flow sequence, `<` unexpected);
strict validate caught it, quoting the value resolved it. `claude plugin details <name>` alone does
not accept a path or `--plugin-dir`; the flag belongs to the top-level `claude` command, so
`claude --plugin-dir . plugin details dogwatch` is the working inventory call.

**Decisions.** Two run-local (`.dogwatch/decisions.md`): commands are static markdown not a template;
`argument-hint` values must be quoted. One permanent: `docs/DECISIONS.md` D-018.

**Descoped.** None. README command surface documents the CLI (`dogwatch ...`); the plugin's install
and marketplace docs are M03's, so the README is left for that milestone.

**Next step.** M03 - marketplace manifest and install docs.
