# Decisions - v04-plugin

## M01 - plugin version stays 0.3.0 (2026-08-19)

Context: M01 requires `plugin.json` version to equal `package.json` version, but the run is v0.4.
Decision: set both to 0.3.0, the current `package.json` value; do not bump. Rejected: bumping to
0.4.0 now. Why: the version bump that closes v0.4 belongs to M04 ("Release plumbing... closing
v0.4"). Bumping early would put a version in the manifest that no release backs.

## M01 - plugin files stay out of the npm tarball (2026-08-19)

Context: `package.json` `files` is `["dist", "README.md", "LICENSE"]`; the new plugin files are
`.claude-plugin/plugin.json` and `skills/dogwatch-supervisor/SKILL.md`. Decision: leave `files`
unchanged, so `npm pack` still ships four files (dist/cli.js, README, LICENSE, package.json).
Rejected: adding the plugin files to the tarball. Why: npm is the CLI distribution channel; the
plugin is installed from git through the marketplace (M03). The npm consumer runs `dogwatch skill
install`, which writes the skill from `SKILL_TEMPLATE` compiled into `dist/cli.js`, so it needs
neither file. `npm pack --dry-run` verified: 4 files, no plugin paths.

## M01 - author name from LICENSE (2026-08-19)

Context: `plugin.json` needs `author.name`; `package.json` has no `author` field to agree with.
Decision: use "Fabian R.", the LICENSE copyright holder. Rejected: the git user name "Fabrodz".
Why: the LICENSE is the existing public attribution in the tree; the git handle is not.
