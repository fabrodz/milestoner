# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semantic versioning.

## [Unreleased]

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
- The README no longer claims CI covers only Linux and Windows, and says the Windows jobs are red.

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
