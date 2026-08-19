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

## M02 - commands are static markdown, not generated from a template (2026-08-19)

Context: M01's skill ships twice (CLI-written file plus plugin component) so it needs a template
compiled into `dist/cli.js` and a drift guard. The commands ship only as plugin components; the CLI
never writes them. Decision: author them as static files under `commands/` and let the test validate
them directly. Rejected: putting the text in `src/templates/` with a `gen:` script and a byte-equality
guard like the skill. Why: there is no second copy to drift against, so a template would add a build
step and a guard for a problem that does not exist. The M02 task made the template guard conditional
on generation, and nothing here is generated.

## M02 - `argument-hint` values must be quoted (2026-08-19)

Context: `argument-hint: [--run <name>] [--milestones <n>]` failed `claude plugin validate --strict`
with a YAML parse error - the bracket is read as a flow sequence and `<` is an unexpected token.
Decision: quote the value (`"[--run <name>] ..."`). Rejected: dropping the hint. Why: the hint is the
usage line the runtime shows; quoting keeps it and validates.

## M03 - marketplace named `dogwatch`, so install is `dogwatch@dogwatch` (2026-08-19)

Context: a single-plugin in-repo marketplace needs a `name`; the plugin is also `dogwatch`. Decision:
name the marketplace `dogwatch`, giving the install `claude plugin install dogwatch@dogwatch`.
Rejected: a distinct name like `dogwatch-marketplace` to avoid the repeated word. Why: the repo is
`fabrodz/dogwatch`; a marketplace named after it reads straight from the `add` command, and the
`plugin@marketplace` redundancy is cosmetic. Category `workflow` on the entry; strict validation
accepts it. Shared fields (name, description, version, author, license, homepage, keywords) are
copied verbatim from `plugin.json` so `claude plugin tag` finds them in agreement.
