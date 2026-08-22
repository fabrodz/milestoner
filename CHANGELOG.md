# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semantic versioning.

## [Unreleased]

A run can be created, written, configured, started, corrected and read from the browser. The panel
was already the run's control surface once a run existed; what it grew here is everything before
that and everything the CLI could do that it could not. The walkthrough is in
[the guide](docs/GUIDE.md#the-panel-only-workflow-start-to-finish); what stays outside the browser
is bringing the panel up.

### Added

- A run can be created from the panel. The hub grows a **New run** card - directory, optional run
  name, milestone count - posting to `POST /api/init`, which calls the same `init()` the CLI does,
  so the scaffold and its refusals are the command's. The new project is recorded in
  `~/.milestoner/projects.json`, so it joins the hub listing on the next refresh with no CLI command
  run anywhere.
- `POST /api/init` validates its body before `init()` sees it: the path must be absolute and an
  existing directory (a relative one would resolve against the panel daemon's working directory, and
  a missing one is refused rather than created), `milestones` takes the CLI's 1-99 bounds, and
  `force` must be an explicit `true`. It is behind `--write`, the key, the `Host` allowlist and the
  `Origin` check like every other mutation, and it is a machine-panel route: a panel serving one
  project answers 404. Only an existing-config refusal reveals the force checkbox; a protocol naming
  another run (D-030) is refused even with force and says which run it names, because force cannot
  answer it. The reasoning for accepting a filesystem path over HTTP is D-038.
- `.milestoner/config.json` can be read and edited from the panel. The per-run view carries the whole
  document in a text box, fed by `GET /api/config` and saved by `POST /api/config`, so every key -
  the `infra` thresholds, `fallbackAgents`, `liveness`, `environment`, the agent command - is
  reachable without leaving the browser. A runner that is already going read its config at startup,
  so an edit applies to the next one; the card says so rather than blocking the edit.
- A save is validated by the loader itself: the submitted text is parsed and put through the same
  checks `loadConfig` runs on every runner start, and only a document that passes is written, through
  the same atomic write every other engine write uses. A refusal carries the loader's own sentence
  (`missing required field "agent"`, or the JSON parser's position) and leaves the file byte for byte
  as it was, so nothing that would stop the next runner from starting can be saved from the panel.
  `projectRoot` is dropped rather than written, as `init` has always left it out.
- A model per milestone: `models` in `.milestoner/config.json` maps a milestone id to the model its
  session runs on (`{"M03": "opus"}`), so a plan can spend a cheap model on the mechanical
  milestones and a stronger one on the hard ones. It is resolved at each session launch, not once
  at startup, so an edit mid-run applies from the next session. `--model` overrides the whole map;
  a fallback agent keeps its own `model`, because model names are not interchangeable across
  agents. `milestoner lint` warns (`orphan-model`) about a `models` key naming no milestone in
  `state.json`, which is otherwise a model silently never used.
- A model field on every milestone card, holding that milestone's entry in the `models` map and empty
  when it has none. Saving reads the config, changes that one key and sends the whole document back
  through the same validated endpoint; clearing the field removes the entry and the milestone goes
  back to the agent's own model.
- The panel starts a run with the same options the CLI takes. `POST /api/run/start` accepts
  `milestone`, `once`, `maxAttempts` and `model` beside `noLint` and translates each to its flag on
  the spawned runner; the start control grows a collapsed options row with a milestone picker built
  from the run's own ids, a "one session, then stop" box, an attempts field and a model field, all
  optional, posting only what was filled in. "Unstick the environment" gains a seconds input that
  overrides `environment.attendSeconds` for that one run of the adapter.
- Start options are validated in the panel's process before anything is spawned: an unknown or
  empty `milestone`, a `maxAttempts` that is not a positive integer, an empty or non-string `model`
  and a non-boolean `once` are refused with a message naming the field and no runner started. The
  runner is spawned detached with its output discarded, so a flag it would reject would otherwise
  fail where nobody can see it.
- The machine panel lists every project on the machine, not only the ones whose runner is alive or
  started while the panel was up. Every command that works inside a project records its directory in
  `~/.milestoner/projects.json` (`init` included), and the hub summarises the ones the registry has
  never heard of from their own `state.json`, reported `unknown` rather than `gone` because nothing
  died there. They resolve for every control, so a run can be started, steered or unblocked from the
  browser after a reboot. Writing the file is best-effort, a corrupt one is treated as empty, and an
  entry whose directory is gone is skipped and left in place.
- The milestone prompts and the protocol can be written from the panel. Each milestone card carries
  an editor for its prompt file, collapsed behind an "edit the prompt" link, fed by
  `GET /api/prompt?name=<file>` and saved by `POST /api/prompt`; a **Protocol** card holds
  `.milestoner/protocol.md` through `GET` and `POST /api/protocol`. Nothing structural is checked
  before writing - both files are hand-written prose by design, so the lint card is the feedback
  rather than a write gate, and it refreshes on a save so filling in a skeleton visibly clears its
  `template-residue` findings. A prompt is reachable only by a name some milestone's `prompt` field
  carries: path separators, a missing `.md` or a name no milestone owns are refused, read and write
  alike. Writes are atomic and behind `--write`, the key and the `Origin` check like every other
  mutation; an edit applies to the next session launched, as steering does, and the editors say so.
- Direct tests for the `api.ts` handlers, which the panel's whole write surface goes through and
  which until now were only exercised indirectly over HTTP.

### Fixed

- The hub is reachable on a machine with exactly one project. It opens that run on arrival, as
  before, but "all runs" now says so in the URL and stays on the hub instead of bouncing straight
  back into the only run - which left the hub, and now the new-run form on it, unreachable.
- `GET /api/transcript` with no `name` answers 404 rather than 500. An empty name resolved to the
  logs directory itself, and reading a directory as a file threw `EISDIR`, which the panel returned
  as a filesystem error message.

## [0.8.0] - 2026-08-21

### Added

- `milestoner lint`: checks the run's form - every milestone prompt, the protocol header and the
  config - before a session spends real time on it. Errors (missing prompt file, scaffold residue,
  missing objective or criteria, a criterion without an evidence note, an exit section without the
  run's tag) exit `1`; warnings (orphaned prompt, protocol naming another run, empty liveness)
  alone exit `0`. `--json` prints `{ run, errors, warnings, findings }` for scripts. The rules are
  the pure `lintRun` core in `src/lint.ts`; the line between form and judgement is D-035.
- `milestoner run` lints at startup: error-level findings on milestones that are still pending
  refuse the start with the findings printed the way `milestoner lint` prints them, exit `1`,
  before any session, state change or panel. `--no-lint` skips the gate; findings on done or
  blocked milestones never stop a resume, and warnings never block. Every start, gated, clean or
  bypassed, writes one `lint` summary line to `run-log.md`.
- The web panel keeps lint parity with the terminal: `GET /api/lint` returns exactly what
  `milestoner lint --json` prints, behind the same auth as every API route; the panel shows a lint
  card with the counts and the per-milestone findings before anything is started. Starting a run
  from the panel lints first, in the panel's process (the runner is spawned detached with its
  output discarded, so its own gate would refuse invisibly): error-level findings on pending
  milestones refuse with the counts and the first findings in the message, and a deliberate
  "start anyway" control passes `--no-lint` through to the spawned runner so the run log records
  the bypass.

### Removed

- `publish.yml`, one release after it arrived. Its first exercise ended at npm auth (the trusted
  publisher was never configured) and 0.7.0 went out by hand; a publish is one command with
  `prepublishOnly` already gating it, so the automation was overhead, not safety.

### Fixed

- `bin` drops its `./` prefix. npm 11 warns that the `./dist/cli.js` form is invalid and rewrites
  the manifest while publishing; the plain relative path publishes clean, and npm 10 accepts both.

## [0.7.0] - 2026-08-21

### Added

- The planner skill, `milestoner-planner`: plans a run together with the user - it interviews,
  proposes the milestone breakdown for approval, and only then writes the prompts, the protocol
  TODOs and the liveness config. It never writes before approval and never invents an acceptance
  criterion, so the boundary against generated specifications (D-031) stands; the argument is
  D-032. Shipped like the supervisor skill: one source in `src/templates/`, written by
  `milestoner skill install`.
- `milestoner init` now points at the planner skill for the authoring steps it cannot do itself.
- `milestoner skill install -g` as the short form of `--global`.
- A `publish.yml` workflow: pushing a `v<semver>` tag publishes to npm, after checking the tag
  against `package.json` and letting `prepublishOnly` run the typecheck, tests and build.
- The machine panel (D-033): `milestoner serve --all` serves every run the registry knows about,
  from any directory - a hub across runs plus the familiar per-run view with a switcher. The first
  `milestoner run` on the machine brings it up as a detached daemon that stays while any run is
  alive (plus a ten-minute linger) and then exits and cleans up after itself; every run prints its
  URL, discovery is `~/.milestoner/panel.json`, and `milestoner runs` names the URL when a panel
  is live. `--no-panel` opts a run out.
- `milestoner run --open` opens the machine panel in the browser without writing the key into
  browser history: the CLI mints a single-use token and the panel exchanges it at `/auth` for an
  HttpOnly cookie, so the URL history keeps is already dead. By default the browser opens only on
  the run that started the daemon; `--no-open` stops even that. D-027's refusal of `--open` for
  the attached `run --serve` panel stands.

### Changed

- `milestoner skill install` takes an optional skill name (`supervisor`, `planner`, or the full
  names). With no name it installs every bundled skill, where it previously installed only the
  supervisor; `--print` now requires a name.
- `milestoner run` now brings the machine panel up by default (read-write: kill, steer and unblock
  at 3am are why it exists; the guards are the same loopback bind, Host allowlist, key and Origin
  check as always). `run --serve` keeps its per-run attached panel unchanged and skips the machine
  panel.

### Removed

- The Claude Code plugin and its in-repo marketplace (D-034). The plugin could not do anything
  without the npm-installed binary its commands and skills shell out to, so it was a second copy
  of the npm channel, not a second channel. `milestoner skill install` is now the one way to get
  the skills, and with them gone go `commands/`, the generated `skills/` mirror, the manifest
  sync/check scripts, and the manifests CI job.

## [0.6.1] - 2026-08-21

Documentation only; the engine is byte-identical to 0.6.0. The package's front page on npm is the
README from its own tarball, so a README this size and this wrong about its own licence was worth a
patch release rather than waiting for the next feature.

### Fixed

- The licence badge claimed Apache 2.0. The project is MIT, as `LICENSE`, `package.json` and the
  published package all say, and it always has been. The CI badge pointed at an unrelated
  repository's workflow.
- README images used repository-relative paths. The published tarball carries four files and
  `docs/assets/` is not among them, so those images rendered on GitHub and broke on the package
  page. They are absolute now.

### Removed

- `BRIEF.md`, the genesis document. Its architecture section was the only place recording that the
  engine is generic, the protocol is templated and milestone prompts are always hand-written, and
  three documents cited it; that claim is now D-031, where a decision belongs. Its "product
  decisions to make first" section had been resolved into D-001 to D-009 since 2026-08-18, and its
  suggested roadmap stopped at v0.4 and had been overtaken.
- `docs/PLAN-v05.md`, a plan that has been executed. What it planned is in the `[0.5.0]` and
  `[0.6.0]` entries here and in D-025 to D-030.
- `docs/PLAN-flow-authoring.md`. Its substance, including the `milestoner lint` experiment that
  would settle the question with data instead of taste, is folded into item 5 of `docs/NEXT.md`.
- `docs/runs/`, the archived record of the `v04-plugin` run, and `.milestoner/` is now gitignored
  rather than partly tracked. A run's state and evidence belong to the machine that ran it. Both are
  in this repository's git history up to v0.6.0 for anyone who wants to read what those sessions
  wrote.

### Documentation

- `README.md` is a quarter shorter. Five sections duplicated `docs/GUIDE.md` and one of them, the
  agent recipes, had drifted into being a strict subset of it. Each now carries what a reader needs
  before installing and links to the guide for the rest. The panel's security model stays in the
  README, condensed rather than moved, because a write-enabled panel is a remote code execution
  endpoint and that is not a detail to look up elsewhere.
- The roadmap's validation paragraph said v0.5 was a four-milestone run. It was seven, three of
  which were bugs the run found in the engine while executing.

## [0.6.0] - 2026-08-20

The first version published to npm, and the first three milestones the engine set for itself. M01 to
M04 of the `v05-debt` run were debt planned in advance; M05, M06 and M07 were bugs that run exposed
by executing, in the engine that was executing it. Two of the three cost the run real attempts before
anyone knew they existed.

A minor rather than a patch, despite reading as a list of fixes: `init` now refuses where it
previously proceeded, the tag scheme the templates write has changed, and there is a new
`infra.crashTranscriptBytes` option.

### Added

- `infra.crashTranscriptBytes` (default 100 B), the threshold below which a transcript is read as a
  crash regardless of how long the session ran. See the refund entry under Fixed.

### Changed

- The protocol and milestone templates tag green milestones `<run>-<milestoneId>` instead of
  `<run>/<milestoneId>`. A tag with a slash collides with the branch name a session naturally picks
  for the same milestone, and `git push origin <name>` then fails with `src refspec matches more
  than one`. Existing tags are untouched. Recorded as D-030.

### Fixed

- `milestoner init` over an existing `.milestoner/` no longer silently keeps a protocol that names a
  different run. The protocol is hand-edited, so `init` still never rewrites or deletes it; what it
  does now is stop with exit 1 before scaffolding anything when `.milestoner/protocol.md` names
  another run in its header, and say what to bring in line. Previously every session of the new run
  was handed the finished run's rules, tag instruction included, and nothing said so - it happened
  to this repository's own v0.5 run. Recorded as D-030.
- A session that crashed mid-run no longer costs the milestone an attempt. The infra classifier
  read a tiny transcript as a crash only inside `infra.deathSeconds` (90 s), so an agent that
  worked for fifteen minutes and then died leaving fifteen bytes was graded `incomplete` and
  charged - it happened to the v0.5 run itself, on a milestone whose work was already done. A
  transcript below `infra.crashTranscriptBytes` (new, default 100 B) with no `result.json` is now
  refunded as a `crash` at any duration; a session that left a real transcript and no result is
  still charged, and the refund shares the existing ceiling of `infra.maxRetries` consecutive
  infrastructure failures. Recorded as D-029.
- Two milestoner processes writing state at the same moment could silently lose one of the writes:
  an `unblock` issued while the runner was grading could vanish as if never typed, and a run could
  be missing from `milestoner runs` even though its runner was alive (seen once in CI, where one of
  six simultaneous runners was absent from the listing). The state lock that should have prevented
  this could be broken by a contender in the first instant after it was taken; the lock now names
  its holder from the moment it exists, a lock that cannot be read yet is waited out instead of
  discarded, and the lock is no longer stolen after a 5-second wait. The worst case for a contender
  facing a crashed or wedged holder is a bounded wait (3 or 30 seconds), never a lost update.
  Recorded as D-028.

## [0.5.0] - 2026-08-20

Built as a four-milestone milestoner run (`v05-debt`), the second time the engine has been used on
itself. Three of the four milestones were debt the v0.4 run exposed; the fourth was asked for while
the run was in flight and appended to it.

### Added

- `milestoner run --serve` brings the web panel up with the run and prints its URL, so a run can be
  watched in a browser without a second terminal and a second command. It takes the same `--port`
  (default `4400`) and `--write` as `milestoner serve`. The panel starts before the first session
  launches and closes in the same step that clears `pulse.json` and deregisters the run, so a URL
  never answers for a run that has ended. A port already in use moves the panel to a free one and
  says so rather than failing the run, and a panel that cannot come up at all is a warning, never an
  exit code. The attached panel refuses to start a second runner, because that would be two runners
  writing one `state.json`; every other control, `kill` included, works as it does under `serve`.
  There is no `--open`: the URL carries the run's key, and handing it to a browser writes a live
  credential into the browser's history. Recorded as D-027.
- `milestoner runs [--json]` lists every run registered on this machine, with its project directory,
  run name, current milestone, done/total and a liveness verdict. It is the only command that does
  not need a project: `status` answers for the directory you are in, `runs` answers for the machine.
  It exits `2` when a listed run is blocked or its runner is gone, so it works on a timer.
- A machine-level registry at `~/.milestoner/runs.json`, or `$MILESTONER_HOME/runs.json`. A runner
  registers itself on start, refreshes the entry on every pulse, and removes it in the same step that
  clears the pulse. A runner that was killed never reaches that step, so its entry is kept and
  reported `gone` for 24 hours before expiring, because a run that died overnight is the one worth
  being told about. Writes are serialised with the same lock as `state.json` (D-022) and are
  best-effort: a read-only home directory means no entry, never a run that will not start. An entry
  counts as live only when the pid is alive and the project's own `pulse.json` names that pid and
  that run, so a recycled pid cannot masquerade as a runner. A registered project whose `.milestoner/`
  is gone is pruned and reported instead of failing the listing. Recorded as D-025.

### Changed

- `milestoner kill` and the runner's second interrupt now end the whole agent session on macOS and
  Linux, not just the process the engine spawned. The session is launched in its own process group
  and the group is signalled, so an agent reached through a wrapper script no longer survives the
  kill and is left orphaned. The signal escalates from `SIGTERM` to `SIGKILL` after five seconds, so
  a session that ignores the first one cannot leave the runner waiting. Windows already killed the
  tree with `taskkill /T /F` and is unchanged, except that the runner's abort path now uses that
  same tree kill instead of signalling the one process. One consequence worth knowing: a Ctrl-C in
  the terminal running `milestoner run` no longer reaches the agent directly, which is what makes the
  first interrupt mean "finish and grade this session" on POSIX as it already did on Windows.
  Recorded as D-026.
- Renamed from `dogwatch` to `milestoner`. The npm package and the command are `milestoner`, the
  state directory is `.milestoner/`, the supervisor skill is `milestoner-supervisor`, and the slash
  commands are `/milestoner-init`, `/milestoner-status`, `/milestoner-supervise` and
  `/milestoner-report`. A run parked under `.dogwatch/`, `.pulseflow/` or `.runpulse/` is still found
  and told how to migrate, and `milestoner skill install` now also warns about a stale
  `dogwatch-supervisor` left behind in `.claude/skills/`. Renaming the directory is still the whole
  migration.
- The reason is external rather than a change of heart about the thesis. `dogwatch.com` and the
  DogWatch trademark belong to a pet-containment company trading since 1990, so the name was not
  findable; npm carries an unpublished `dog-watch` that can block `dogwatch` at publish time under
  the too-similar rule; and the nautical dog watch is the short evening watch (16:00-20:00), not the
  night shift the README claimed. `milestoner` is free on npm as both `milestoner` and
  `mile-stoner`, the GitHub account is free, `milestoner.dev` is unregistered, and no software
  product carries the name.
- `docs/runs/v04-plugin/` keeps the old name deliberately. Those files are the captured evidence of
  a finished run, raw command output included; rewriting them would falsify the record this engine
  exists to keep. Released changelog entries below are left alone for the same reason: they describe
  what shipped, under the name it shipped with.

### Fixed

- `npm test` failed on Windows. Two causes, both in the tests: with no `.gitattributes`, git checked
  the tree out as CRLF and the tests that split `---\n` frontmatter out of `commands/*.md` and the
  shipped `SKILL.md` concluded there was no frontmatter; and `lock.test.ts` handed Node an absolute
  Windows path where an ESM specifier was expected, which Node rejects because `D:` reads as a URL
  scheme, so all six writer children exited 1. The tree is now pinned to LF, the parsers normalise
  line endings, and the child's specifier is built with `pathToFileURL`. The cross-process locking
  guarantee from D-022 is verified on Windows for the first time rather than skipped by a load
  failure.

### Documentation

- The changelog itself: six entries describing additions (`infraFailurePatterns`, the different-agent
  recipes, `attend.sh`, macOS CI, `fallbackAgents`, `dogwatch serve`) were filed under `Fixed`, and
  the `dogwatch serve` entry plus a `pulseflow`-era rename note were duplicated into `[0.2.0]`, where
  neither belongs. Releases 0.1.0 to 0.3.0 now carry dates.
- `docs/DECISIONS.md`: three decisions taken during v0.4 had no entry. D-020 records the local web
  panel and states plainly that it supersedes D-015's rejection of "a live web view with a server",
  with what changed; D-021 records benching a failing agent instead of waiting for it, and why
  `infraFailurePatterns` was needed once agents other than Claude Code were in play; D-022 records
  serialising `state.json` writes and the `rev` counter.
- `docs/GUIDE.md` announced itself as v0.3. It now says v0.4, and its limits section names what v0.4
  actually lacks: no view across runs, `kill` reaching one process rather than a tree off Windows,
  and the failing Windows test suite.
- `docs/NEXT.md` was written before v0.4 and had been overtaken almost entirely. Rewritten around
  what is actually left, and recording that its own prediction about `promptDelivery` was wrong.
- The README no longer claims CI covers only Linux and Windows. The caveat it carried for part of
  this release, that the Windows jobs were red, is gone with the cause.

## [0.4.0] - 2026-08-19

### Added

- Claude Code plugin packaging. The repository is now a plugin as well as an npm CLI: a
  `.claude-plugin/plugin.json` manifest, the supervisor shipped as a plugin component at
  `skills/dogwatch-supervisor/SKILL.md`, four slash commands (`/dogwatch-init`, `/dogwatch-status`,
  `/dogwatch-supervise`, `/dogwatch-report`) under `commands/`, and an in-repo single-plugin
  marketplace at `.claude-plugin/marketplace.json`. Install with
  `claude plugin marketplace add fabrodz/dogwatch` then `claude plugin install dogwatch@dogwatch`.
  The plugin is a Claude Code layer over the engine; it does not put the `dogwatch` binary on PATH,
  so it needs the CLI install to do anything.
- The supervisor skill now ships from one source. The plugin component and the file
  `dogwatch skill install` writes both come from `SKILL_TEMPLATE`; `npm run gen:skill` (wired into
  `build`) regenerates the shipped copy, and a test asserts the two are byte-identical so they
  cannot drift.
- Single-sourced version. `package.json` is the source; `npm run sync:version` derives the version
  into both plugin manifests, and a test fails when the three declarations disagree.
- The manifest cannot silently rot. `npm run check:manifests` validates the plugin and marketplace
  manifests with a schema-level check that needs no CLI, wired into CI so a bad or drifting manifest
  fails the build; the strict `claude plugin validate` runs in addition wherever the CLI is present.

- MIT `LICENSE` file. The package declared the licence without shipping one.
- CI on GitHub Actions: typecheck, tests and build on Node 20, 22 and 24, on Linux and Windows.
- A section in the README and the guide on what `--dangerously-skip-permissions` actually grants an
  unattended session, and what reduces the risk.

- `infra.infraFailurePatterns`: case-insensitive substrings that mark an agent or backend failure
  which is not a usage limit (a model endpoint that never answered, an expired login, a dropped
  stream). Refunds the attempt like a usage limit but waits `genericWaitSeconds`, since there is no
  announced reset. The tiny-transcript rule alone is a Claude Code shape; chattier agents narrate a
  startup failure for kilobytes and were charged an attempt for it.
- A "Running a different agent" section in the README and the guide, with verified Codex and
  Ollama-through-Codex recipes.
- `examples/adapters/attend.sh`: the macOS and Linux counterpart to `unity-attend.ps1`, so the
  environment adapter has a starting point on every platform rather than only on Windows. Both
  follow the same contract, which `examples/adapters/README.md` and the guide now state explicitly.
- CI covers macOS as well as Linux and Windows. The platform-specific paths (the `cmd.exe` shim,
  `taskkill`, the report opener) had no macOS runner exercising them.
- `fallbackAgents`: a list of agents to fall back to when the one in use is out of quota or failing
  for a reason the infra rules recognise. The failing agent is benched for the cooldown its failure
  implies and the next free one takes over immediately, so a usage limit with a three-hour reset no
  longer costs three idle hours when a second agent is authenticated. The bench is a cooldown, so
  the primary returns when its quota does. Never triggers on a work verdict. The agent that ran each
  attempt is recorded in `state.json`, `run-log.md`, the report and `status`.

- `dogwatch serve`: a local web panel for a run. Shows what `status` shows, refreshed over
  server-sent events, and exposes the CLI's own write surface - steer, unblock, kill, attend, start
  and stop a runner - by calling the same functions, so interventions land in the same logs. Bound
  to loopback, key required per request, `Host` and `Origin` checked, read-only unless `--write`.
  A write-enabled panel can start an unsandboxed agent and run the environment adapter through a
  shell; the README and the guide say so plainly, and document SSH forwarding as the one supported
  way to reach it from another device.

  The panel leads with a plain-language verdict - what is happening, why, and when it needs a human,
  the single action the session asked for. Engine events are rendered from `run-log.md`'s machine
  format into sentences with relative times, outcomes read as words rather than enum values, and the
  internal vocabulary ("attempts charged", "infra-failure") is gone from the page.

### Fixed

- `npm test` failed on Node 20, the declared minimum: globs in `node --test` need Node 22. Test
  files are now discovered by a small script that also works where no shell expands the pattern.
- The run report showed an invented attempt budget. It used the highest attempt count seen in the
  run as the denominator, so a milestone that passed first try read `0/1 attempts`. It now reads
  `maxAttempts` from the config and reports the session count alongside it.
- `dogwatch run --once` exited `0` on a milestone that reported blocked, contradicting the
  documented exit codes. It now exits `2`, like a full run.
- A milestone that recovered kept the diagnosis written by the attempt that failed, so `status` and
  the report described a live block on a milestone that was done.
- Two sessions of one milestone starting in the same second shared a transcript path and appended to
  the same file. Transcript names now carry milliseconds.
- `init` wrote `projectRoot` into the generated `config.json`, where it was always overridden by the
  directory the config was found in. Editing it did nothing.

### Changed

- Renamed from `pulseflow` to `dogwatch`. The state directory is `.dogwatch/`, the command is
  `dogwatch`, and the supervisor skill is `dogwatch-supervisor`. A run parked under `.pulseflow/` or
  `.runpulse/` is still detected and the CLI prints the one-step migration: the layout is derived
  from the directory name, so renaming the directory is the whole migration. Older names accumulate
  rather than replace each other, so a run that missed a rename is not stranded by the next one.

- `docs/GUIDE.md` documented v0.2 and listed steering and the HTML report as unshipped. It now covers
  both, and its "Limits" section reflects v0.3.
- The published package includes `LICENSE`.

## [0.3.0] - 2026-08-19

### Added

- `dogwatch report`: a single self-contained HTML report of the run, with a wall-clock timeline.
- `dogwatch steer`: mid-flight corrections injected into every session launched from then on.
- One interrupt finishes the current session and stops; a second kills it.

## [0.2.0] - 2026-08-18

### Added

- The active supervisor as an installable Claude Code skill (`dogwatch skill install`).
- `dogwatch kill` and `dogwatch attend`, the supervisor's only interventions, both logged.
- The environment adapter as a config string.

## [0.1.0] - 2026-08-18

### Added

- The engine: `init`, `run`, `status`, `unblock`. Milestone state machine, evidence gates,
  infrastructure-failure discrimination, liveness from side signals.
