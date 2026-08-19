# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses semantic versioning.

## [Unreleased]

### Added

- MIT `LICENSE` file. The package declared the licence without shipping one.
- CI on GitHub Actions: typecheck, tests and build on Node 20, 22 and 24, on Linux and Windows.
- A section in the README and the guide on what `--dangerously-skip-permissions` actually grants an
  unattended session, and what reduces the risk.

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

### Changed

- Renamed from `pulseflow` to `dogwatch`. The state directory is `.dogwatch/`, the command is
  `dogwatch`, and the supervisor skill is `dogwatch-supervisor`. A run parked under `.pulseflow/` or
  `.runpulse/` is still detected and the CLI prints the one-step migration: the layout is derived
  from the directory name, so renaming the directory is the whole migration. Older names accumulate
  rather than replace each other, so a run that missed a rename is not stranded by the next one.

- `docs/GUIDE.md` documented v0.2 and listed steering and the HTML report as unshipped. It now covers
  both, and its "Limits" section reflects v0.3.
- The published package includes `LICENSE`.

## [0.3.0]

### Added

- `dogwatch report`: a single self-contained HTML report of the run, with a wall-clock timeline.
- `dogwatch steer`: mid-flight corrections injected into every session launched from then on.
- One interrupt finishes the current session and stops; a second kills it.

## [0.2.0]

### Added

- The active supervisor as an installable Claude Code skill (`dogwatch skill install`).
- `dogwatch kill` and `dogwatch attend`, the supervisor's only interventions, both logged.
- The environment adapter as a config string.

### Changed

- Renamed from `runpulse` to `dogwatch`. A `.runpulse/` directory is detected and the CLI explains
  the one-step migration.

## [0.1.0]

### Added

- The engine: `init`, `run`, `status`, `unblock`. Milestone state machine, evidence gates,
  infrastructure-failure discrimination, liveness from side signals.
