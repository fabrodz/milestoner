# Product decisions

Every product decision, dated, with the alternative that was rejected and why. Superseding an entry
means adding a new one that points back at it, not editing history.

D-001 to D-009 answer the questions the project opened with, framed before any code existed. D-031
records the three-layer architecture those questions assumed.

## D-001 - Runtime: Node CLI, not shell scripts (2026-08-18)

The engine is a Node CLI distributed on npm. The PowerShell orchestrator from the original runs was
the behavioural specification, not the codebase; it was removed once every rule it carried existed
in `src/` under test, and it remains in the git history.

Rejected: keeping PowerShell. It is Windows-only, it string-parses JSON, and every rule that
matters (attempts, infra discrimination, evidence grading) is untestable there. Those rules are the
product; they need unit tests.

Not yet: the Claude Agent SDK. v0.1 spawns the agent as an opaque subprocess, which is what makes
D-005 possible. The SDK becomes interesting when we want streaming and cost telemetry, and it will
sit behind the same agent-config seam.

## D-002 - Distribution: npm first, Claude Code plugin later (2026-08-18)

`npx milestoner init|run|status|unblock` in v0.1. The supervisor ships as a Claude Code skill in v0.2
and the whole thing gets plugin packaging in v0.4.

The split follows the natural shape: the runner is a process that must survive a dead session, so
it is a CLI. The supervisor is judgement applied on a schedule, so it is a Claude session.

## D-003 - Supervisor host: a Claude session on `/loop` (2026-08-18)

Keep what already works overnight in production. No daemon, no service, no second process to
babysit. A daemon that spawns supervisor sessions is a v0.3+ question and only if `/loop` proves
insufficient.

## D-004 - Observability: `status` plus a pulse block in v0.1 (2026-08-18)

`milestoner status` prints the milestone table and a **pulse** block: is a runner process alive, what
is it on, how long has the current session been running, and how old is the newest liveness signal.

Liveness comes from side signals only - watched source dirs, test-result files, tool logs - never
from the transcript, because a headless `claude -p` flushes its transcript only at exit. The watch
list is `liveness` in config.json, per project.

Rejected for v0.1: the HTML report (v0.3) and a live web view. A status command a supervisor can
poll is the minimum that makes the pulse real.

## D-005 - The agent command is a config string from day one (2026-08-18)

`agent.command` plus an `agent.args` template with `{{kickoff}}`, `{{promptFile}}`,
`{{milestoneId}}`, `{{projectRoot}}`, `{{milestonerDir}}` and `{{model}}` placeholders. Swapping
Claude Code for Codex or Cursor is a config edit; the engine never learns agent names.

Only Claude Code is tested in v0.1. The seam is cheap now and expensive to retrofit.

## D-006 - The engine owns state.json; the session writes result.json (2026-08-18)

Departure from the reference implementation, where the executor session edited `state.json`
directly and the orchestrator trusted it.

The session now writes one small drop box, `.milestoner/result.json`:

```json
{ "milestone": "M01", "status": "done", "evidence": ["AC1: ..."], "notes": "" }
```

The engine grades it, merges it into `state.json`, and archives the raw claim under
`.milestoner/results/<id>-attempt<n>.json`. The agent's write surface shrinks from the whole state
machine to one file it cannot corrupt anything else with, and every attempt keeps its own record.

The trust rule from the reference survives intact: the verdict comes from what the session wrote,
never from its exit code.

## D-007 - Evidence is a gate the engine enforces, not a convention (2026-08-18)

`status: "done"` with an empty `evidence` array is downgraded to incomplete and retried. `blocked`
without a diagnosis (symptom + userAction) still blocks, because retrying a real block only burns
attempts, but the missing diagnosis is logged as a warning against that attempt.

## D-008 - Infra failures never consume an attempt (2026-08-18)

Ported from the reference and widened. A session is infrastructure, not work, when it wrote no
result **and** ended faster than `infra.deathSeconds`, and either its transcript is smaller than
`infra.tinyTranscriptBytes` or it matches a usage-limit pattern.

Widening: a usage-limit transcript counts even when it is large, and an announced reset time
("resets 3:00pm") is parsed and waited out exactly instead of sleeping a fixed ten minutes. A
parsed wait longer than twelve hours is treated as a misparse and falls back to the fixed wait.

The MVP run burned three attempts in forty seconds against a usage limit before this rule existed.

## D-009 - v0.1 scope: init, run, status, unblock (2026-08-18)

Supervisor skill and the adapter interface stay in v0.2 as the roadmap has them. `unblock` is the
one addition: with the engine owning state.json, clearing a block cannot be a hand edit any more.
Clearing it is always a human decision - the engine never resets a block on its own.

## D-010 - The supervisor is a skill, installed by the CLI (2026-08-18)

`milestoner skill install` writes `.claude/skills/milestoner-supervisor/SKILL.md` into the project
(`--global` for `~/.claude/skills/`). The user starts it with
`/loop 10m Use the milestoner-supervisor skill to perform one supervision cycle.`

Rejected for now: shipping it as a plugin. Plugin packaging is v0.4 and brings a marketplace repo
with it; a file the CLI writes needs neither. The skill text lives in the engine
(`src/templates/skill.ts`) so the playbook and the commands it calls are versioned together and
tested against each other.

## D-011 - The supervisor reads the run through `status --json`, not by parsing files (2026-08-18)

One call returns everything the playbook keys on: statuses, attempts, evidence counts, diagnoses,
runner liveness, agent pid, current transcript, newest liveness signal with an age verdict, whether
an adapter is configured, and the tail of both logs.

The reference supervisor stat-ed Unity log paths and grepped `Get-CimInstance Win32_Process`. That
is per-project and per-OS, which is exactly what a generic engine must absorb. Anything a
supervision rule needs to know belongs in that JSON, not in the skill's prose.

## D-012 - Interventions are engine commands with a narrow surface (2026-08-18)

The supervisor's entire write surface is three commands plus its own log:

- `milestoner kill --reason <text>` kills the **agent session**, never the runner. The runner then
  grades the session as incomplete, consumes the attempt and relaunches with fresh context.
- `milestoner attend` runs the project's configured environment adapter.
- `milestoner run` relaunches a dead runner.

Nothing else: no editing project code, no editing state.json, no running the project's own tools
while a session owns them. `milestoner unblock` is deliberately excluded - clearing a block stays a
human decision, per D-009.

`kill` writes `.milestoner/kill.json` before killing. Without it, a session killed after 20 quiet
minutes can still look like an infrastructure death (short, tiny transcript) and D-008 would refund
the attempt, so the intervention would cost nothing and could repeat forever. The marker makes the
runner grade a deliberate kill as work.

## D-013 - The environment adapter is one config string, not a plugin API (2026-08-18)

`environment.attendCommand` is a shell command line with a `{{seconds}}` placeholder, run by
`milestoner attend`. Being a string is what keeps the engine free of any one environment: the adapter
from the reference run points it at a PowerShell script for a GUI editor, but restarting a wedged
dev server or re-pairing a device is the same one-line change. A headless project leaves it null and
playbook rule 3 simply cannot fire.

Rejected: a TypeScript adapter interface with lifecycle hooks. There is exactly one adapter in
existence and one hook it needs. A plugin API before the second adapter would be guesswork.

## D-014 - Steering persists and is inlined into the kickoff (2026-08-19)

`.milestoner/STEERING.md` is the user's mid-flight channel: a correction that reaches the next
session without killing the current one. `milestoner steer "<text>"` writes it, `--append` adds a
line, `--clear` removes it, and bare `milestoner steer` shows what is in force.

Two choices inside it:

**Inlined, not referenced.** The runner injects the text into the kickoff rather than telling the
session to go read a path. A correction the session never opens is not steering. Injection is
capped at 4000 characters so it cannot crowd out the milestone prompt; longer text is truncated
with a marker rather than silently dropped. Everything inside HTML comments is stripped, so the
note explaining the file to the human never reaches the agent.

**Persistent until cleared.** A correction that applied to one milestone and then silently vanished
would be worse than no channel at all. The cost is that stale steering keeps applying, so every
attempt records the headline that was in force - visible in the run log, in `state.json` history,
and in the report.

Steering does not license dropping an acceptance criterion; the kickoff says so. A steer that makes
a milestone impossible should come back as `blocked`, not as a quietly reduced milestone.

The supervisor cannot write it (D-012). If it thinks the run needs steering, it proposes the
wording in its report and the user runs the command.

## D-015 - The report is one self-contained HTML file, generated on demand (2026-08-19)

`milestoner report [--out <path>] [--open]` renders `state.json` plus both logs into a single file:
stat tiles, a wall-clock timeline of every session that ran, one card per milestone with its
evidence and diagnosis, the attempt table, and the intervention log.

No scripts, no external assets, no build step - it opens from a file:// path, survives being
emailed, and works offline. Enforced by a test, not by convention.

Two things the report makes visible that `status` cannot: the **gaps** (a usage-limit wait looks
different from a slow session when both are on the same timeline), and the **infrastructure retries
that were not charged**, which is the rule from D-008 made auditable after the fact.

Everything in it is agent-authored text, so every value is HTML-escaped. That is also a test.

Rejected: a live web view with a server. The report answers "what happened overnight"; `status`
and the supervisor already answer "what is happening now".

## D-016 - Renamed to milestoner (2026-08-19)

The package, the binary and the state directory are `milestoner` / `.milestoner`. Every reference in
the source, the templates, the supervisor skill and the docs moved with it. D-001 to D-015 describe
the same decisions; only the name changed.

Nothing was published under the old name, so there is no npm deprecation to do. The one thing that
breaks is a run set up before the rename: its state lives in `.runpulse/`, which the CLI no longer
looks for as a working project. It is still detected, and every command that needs a project stops
with the migration instead of a generic "not found":

```
found <path>/.runpulse - this run was set up before the tool was renamed to milestoner
  ren "<path>/.runpulse" .milestoner
```

The layout is derived from the directory name and nothing inside stores it, so renaming the
directory is the whole migration - a run in progress keeps its state, evidence and history. A test
asserts that every path in the layout hangs off the directory name, which is what makes that true.

`skill install` also warns when a `runpulse-supervisor` skill from before the rename is still
present, since it tells the agent to run commands that no longer exist. It reports it rather than
deleting it: files under `.claude/` are the user's.

## D-017 - The skill ships twice, from one source (2026-08-19)

Supersedes the "for now" in [D-010](#d-010---the-supervisor-is-a-skill-installed-by-the-cli-2026-08-18).
v0.4 makes the repository a Claude Code plugin, so the supervisor skill now ships as a plugin
component at `skills/milestoner-supervisor/SKILL.md` **as well as** the file `milestoner skill install`
writes. Both come from the same `SKILL_TEMPLATE` in `src/templates/skill.ts`: `npm run gen:skill`
(wired into `build`) regenerates the shipped copy, and a test asserts the two are byte-identical, so
they cannot drift.

D-010 stays true: the CLI keeps writing the file, because the npm consumer has no plugin. This is
the deferred half of [D-002](#d-002---distribution-npm-first-claude-code-plugin-later-2026-08-18) -
a second distribution channel beside npm, not a replacement.

Rejected: making the plugin component the source and having the CLI read it at install time. The
CLI is distributed as a single compiled `dist/cli.js`; reaching for a sibling file at runtime would
break the one-file install that D-001 buys. Compiling the text into the binary and generating the
plugin copy from the same constant keeps one source without coupling the CLI to the repository
layout.

## D-018 - Four slash commands ship; run, serve, and the human-only commands do not (2026-08-19)

The plugin ships four commands under `commands/`: `/milestoner-init`, `/milestoner-status`,
`/milestoner-supervise` and `/milestoner-report`. The test comes from what belongs *inside* a session:
a command earns its place when it is worth running without leaving the session, is not a long-lived
process, and is not a decision or intervention reserved to a human or to the supervisor.

- `/milestoner-init` scaffolds a run and walks the user through authoring the prompts - all in-session
  file work.
- `/milestoner-status` is a read-only read of the run.
- `/milestoner-report` is a read-only artifact generator; it writes the HTML report and opens it,
  touching no state.
- `/milestoner-supervise` runs one supervision cycle by invoking the `milestoner-supervisor` skill. It
  does not duplicate the playbook; the skill remains the single source (D-017).

Rejected, each for a stated reason:

- `run` and `serve` are long-lived processes that must **survive** the session that started them. A
  headless runner or a loopback panel wrapped in a slash command would die with the conversation, so
  the command would be actively misleading. They stay terminal invocations.
- `unblock` and `steer` are human-only decisions the supervisor is explicitly forbidden to take
  (D-012, D-014). A slash command that let a model run them would quietly undo that boundary, so no
  command spells them as a runnable invocation - a test asserts this.
- `kill` and `attend` are supervisor interventions, reached through the playbook the
  `/milestoner-supervise` cycle already runs, not something a human types by hand.
- `skill install` is redundant for a plugin user: the plugin already carries the supervisor skill as
  a component (D-017), so there is nothing to install.

No command hands a model a path to `state.json`, to `unblock` or to `steer` that the supervisor
denies: `state.json` is named only inside a guard, and the two human-only commands never appear as
runnable invocations. `src/plugin-commands.test.ts` enforces both, alongside the presence and
frontmatter of every shipped command.

## D-019 - The marketplace is a single-plugin manifest in this repository (2026-08-19)

The plugin is distributed from a `.claude-plugin/marketplace.json` that lives beside `plugin.json`
in this repository, with one entry whose `source` is `"./"`. A user runs `claude plugin marketplace
add fabrodz/milestoner` then `claude plugin install milestoner@milestoner`; the marketplace and the plugin
it lists are the same repo. `claude plugin validate --strict` accepts it, and `claude plugin tag`
confirms the entry agrees with `plugin.json` on name and version - the agreement M04 automates.

Rejected: a separate marketplace repository. That is only worth its second repo, second release and
second CI when a second plugin is coming; there is one plugin and no plan for another. An in-repo
single-plugin marketplace is what `claude plugin marketplace add <repo>` is built for, keeps the
manifest versioned with the plugin it describes, and is the cheaper option until a second plugin
makes the split pay for itself.

This is the second half of [D-002](#d-002---distribution-npm-first-claude-code-plugin-later-2026-08-18):
the plugin channel now has a marketplace to install from. It does not replace npm. The CLI remains
the engine and the required install; the plugin, delivered through this marketplace, is a Claude Code
layer over it and does not put the `milestoner` binary on PATH.

## D-020 - The local web panel, superseding the rejection in D-015 (2026-08-19)

[D-015](#d-015---the-report-is-one-self-contained-html-file-generated-on-demand-2026-08-19) rejected
"a live web view with a server" on the grounds that the report answers what happened overnight and
`status` answers what is happening now. `milestoner serve` builds it anyway. What changed:

- **`status` answers for a terminal, not for a person away from one.** The panel exists for the
  moment you are not at the keyboard where the run lives. That is the same argument that justified
  the supervisor, and it does not go away because a report exists.
- **The panel is not the report made live.** It leads with a plain-language verdict - what is
  happening, why, and when it needs a human, the single action the session asked for - and renders
  `run-log.md` into sentences. The internal vocabulary ("attempts charged", "infra-failure") is
  deliberately absent. The report stays the post-mortem; the panel is the answer to "is this fine".

The write surface is the CLI's own: steer, unblock, kill, attend, start and stop a runner, each
calling the same function the command calls, so an intervention through the panel lands in the same
logs as one typed by hand. There is no second code path to keep honest.

Security is the reason `--write` is opt-in. A write-enabled panel can start an unsandboxed agent and
run the environment adapter through a shell: it is remote code execution by design. It binds
loopback only, requires a per-process key on every request, and checks `Host` and `Origin`. SSH
forwarding is the one supported way to reach it from another device; the README and the guide say
so rather than leaving it to be discovered.

Note that the panel deliberately does **not** honour the supervisor's boundary: it offers `unblock`
and `steer`, which [D-012](#d-012---interventions-are-engine-commands-with-a-narrow-surface-2026-08-18)
denies the supervisor. That is consistent - those are human decisions, and the panel is a human at a
keyboard, not an automated actor.

## D-021 - A failing agent is benched, not waited for (2026-08-19)

[D-008](#d-008---infra-failures-never-consume-an-attempt-2026-08-18) refunds the attempt and waits
out the reset. Waiting is correct when there is nothing else to run, and wasteful when there is: a
usage limit at 2am with a 5am reset costs three idle hours even if a second agent is authenticated.

`fallbackAgents` makes the primary and its fallbacks one rotation. On an infrastructure verdict the
failing agent is benched for exactly the cooldown its failure implies - the seconds until an
announced reset, so it returns when its quota does - and the next free agent takes over immediately.
Waiting only happens when every agent is benched. It never triggers on a work verdict: a milestone
that failed on its merits is not an agent problem, and rotating there would only spread one bad
attempt across two providers.

The agent that ran each attempt is recorded in `state.json`, `run-log.md`, `status` and the report,
because "which agent produced this evidence" stops being obvious the moment a run uses two.

`infra.infraFailurePatterns` exists for the same reason. The tiny-transcript heuristic in D-008 is
shaped by how Claude Code dies: fast and quiet. A chattier agent narrates a startup failure for
kilobytes and was charged an attempt for what was never work. The patterns refund it like a usage
limit, but wait `genericWaitSeconds` because there is no announced reset to wait for.

## D-022 - state.json writes are serialised across processes (2026-08-19)

Writes were already atomic - temp file plus rename - but atomic is not the same as safe. The runner
and an `unblock` issued at the same moment both load state, both mutate their own copy, and whoever
renames second silently discards the other. Rare while a human types commands one at a time;
routine once a panel can post one.

`withStateLock` serialises the whole read-modify-write on a lock file taken with `wx`. The lock is
broken rather than honoured when its holder is gone, because killing processes is a first-class
operation here (`milestoner kill`, two interrupts, a supervisor relaunch) and a lock that outlived its
owner would be a worse failure than the race it prevents. After a bounded wait the lock is broken
and the write proceeds: a run that stops because a lock never cleared is worse than the race.

`state.rev` increments on every write so a reader can tell a change from a change back. The panel
polls; without a revision, a value that moved and returned looks like nothing happened.

## D-023 - Renamed to milestoner (2026-08-19)

The third rename, and the reasons are all external to the product. `dogwatch.com` and the DogWatch
trademark belong to a pet-containment company trading since 1990, which owns the search results for
the word outright. npm carries an unpublished `dog-watch`, and the registry rejects a new name that
matches an existing one once punctuation is stripped, so `dogwatch` might not have been publishable
at all. And the nautical dog watch is the short evening watch from 16:00 to 20:00, split in two so
the crew rotates; the README sold it as the night shift, which it is not. A name whose only job was
to carry the thesis was carrying the wrong one.

`milestoner` is free on npm as both `milestoner` and `mile-stoner`, the GitHub account is free in
either casing, and `milestoner.dev`, `.io` and `.sh` are unregistered. No software product uses the
name. It also stops describing a metaphor and starts describing the machine: deciding when a
milestone has actually been reached is the whole job.

Rejected: staying on `dogwatch` and fixing only the README, which repairs the metaphor but not the
search results or the publish risk. `looprunner`, which collides with an existing headless Claude
Code harness of the same name. `middlewatch`, accurate and free, but it keeps the product in a
family of `*watch` names that read as file watchers in this ecosystem. `pulseloop`, adopted and
reverted before it left the machine: three unrelated products already use it, the GitHub account and
the .com were taken, and `pulse` named only the liveness half of the engine. `milestoneai`, which
costs the GitHub account and dates the project to a naming fashion that has passed.

Cost accepted: read quickly in English, the name contains "stoner". Kept deliberately, as character
rather than as a defect to design around.

## D-024 - The repository is LF, and the parsers do not trust it (2026-08-20)

`.gitattributes` pins `* text=auto eol=lf`, so every checkout gets an LF working tree whatever
`core.autocrlf` is set to locally. Without it, git handed Windows CRLF and three tests that split
`---\n` frontmatter out of shipped `.md` files concluded there was no frontmatter block. Nothing in
the repository needs CRLF: the one `.ps1` runs fine with LF, and `.sh` requires it.

The parsers normalise line endings anyway, which is deliberate belt and braces rather than
redundancy. The pin governs files that arrive through git; `commands/*.md` and
`skills/*/SKILL.md` are read as shipped artefacts that a user or a packaging step can also produce,
and a parser that fails on CRLF is a parser with a platform bug, not a checkout with one. The same
argument the other way round is why `scripts/gen-skill.mjs` writes LF unconditionally: it runs on
whoever's machine builds, and its output is committed, so anything else makes `npm run build`
produce a diff on Windows and none on Linux.

Rejected: `.gitattributes` alone, which fixes this repository and leaves the parsers wrong. Also
rejected: normalising in the tests alone, which leaves a Windows contributor with a working tree
that differs from CI's byte for byte, and every future byte comparison a coin toss.

## D-025 - A machine-level registry of runs, behind `milestoner runs` (2026-08-20)

`status` and `serve` only ever see the directory they were started in, so "what is running on this
machine" had no answer short of hunting for `.milestoner` directories. The registry is that missing
primitive, and `milestoner runs` is the whole of its surface for now: the panel deliberately does not
span runs yet.

**Live runners are what is registered, with a retention window.** A runner writes its entry on start
and removes it in the same `finally` that clears the pulse, so a clean exit leaves nothing behind. A
runner that was killed never reaches that `finally`, and its entry is kept and reported `gone` for
24 hours before it expires out of the file. The alternative shapes are both worse at the one question
that matters: registering only live runners means a run that died at 2am has simply vanished by
morning, which is precisely the state a person needs to be told about; scanning the disk for every
project that has a `.milestoner/` finds runs nobody has touched in months and turns a cheap question
into a filesystem walk. Keeping the corpse for a day is the middle path, and it is the reason the
command has a `gone` verdict at all.

**`~/.milestoner/runs.json`, one path on every platform.** `MILESTONER_HOME` overrides the directory.
XDG is deliberately not honoured: it would put the registry under `$XDG_STATE_HOME/milestoner` on
Linux and `~/.milestoner` everywhere else, so the guide, the troubleshooting section and the command's
own output would all have to be platform-conditional to name one file, and the per-project directory
users already know is `.milestoner/`. Anyone who wants it under an XDG path, or on a different disk,
points `MILESTONER_HOME` at one. Every registry write is best-effort: a home directory that is
read-only, or on a share that is not mounted, makes registration fail silently and the run continues
without an entry. A convenience across projects must never become a precondition for one.

**A live pid is not enough, so the project's own pulse corroborates it.** Pids are reused. An entry
counts as live only when the pid is alive *and* the project's `pulse.json` exists *and* names that
same pid *and* the same run. The pulse is written by the runner and cleared on exit, so an unrelated
process that inherited the number has nothing vouching for it: the project either has no pulse or has
one belonging to somebody else. What remains uncovered is a killed runner whose stale pulse survives
and whose exact pid is then reused, which the retention window eventually resolves and which no
portable check would catch without process start times.

Writes are serialised with `withStateLock` from
[D-022](#d-022---statejson-writes-are-serialised-across-processes-2026-08-19). Several runners
starting, ticking and exiting against one file is the same lost-update shape, and it did not need a
second locking primitive.

The liveness verdict in `runs` comes from the age of each pulse's last event, on the same thresholds
`status` prints, rather than from the watched-path scan `status` uses. `runs` reads every project on
the machine, and a recursive mtime walk per project would make the cheap question expensive. The two
verdicts share one function so they cannot drift.

`milestoner runs` exits `2` when any listed run is blocked **or** its runner is gone, which is the
same "this needs you" signal `status` gives, widened by the one state this command exists to surface.

## D-026 - The agent session gets its own process group, and the kill escalates (2026-08-20)

`milestoner kill` and the runner's second-interrupt abort both signalled the one pid the engine
spawned. On Windows that was already a tree kill (`taskkill /T /F`); on macOS and Linux it was a
plain `SIGTERM` to the child. An agent is routinely reached through a wrapper - an npm shim, a
launcher script, a login shell - and killing the wrapper leaves the agent it started running,
reparented to init. Playbook rule 4 then reported a kill that had not happened, and the runner sat
waiting for a session that was no longer attached to anything it could see.

**The session is spawned `detached: true` on POSIX**, which makes it the leader of its own process
group, and both kill paths signal `-pid` - the group - falling back to the bare pid if that fails.
Windows keeps `taskkill /T /F`, which already walks the tree and has no gentler step to offer.

**What `detached` changes about Ctrl-C, which is the cost of this and is not incidental.** A
detached child is no longer in the terminal's foreground process group, so a Ctrl-C in the terminal
running `milestoner run` reaches the runner and nothing else. Before, the agent got that SIGINT
directly from the tty and usually died on it. That is a real behaviour change, and it is the one we
want: the two-interrupt contract says the *first* interrupt finishes and grades the running session
and only the *second* kills it, and a tty that kills the agent on the first Ctrl-C quietly broke
that contract on POSIX. Signal delivery is now the engine's decision rather than the terminal's, on
every platform, and `runner.stop.test.ts` is the gate on both halves of it.

The rejected alternative was leaving the spawn attached and walking the process table for children
of the pid. It needs a different implementation per platform (`ps -o ppid=`, `pgrep -P`, recursion
over the results), it races a wrapper that is still spawning, and it reimplements what the kernel
already tracks. A process group is the portable POSIX answer to exactly this question.

**SIGTERM, then SIGKILL after five seconds.** A session that traps or ignores the polite signal used
to leave the caller believing it had killed something, and the runner waiting on a child that was
never going to close. The escalation is skipped on Windows because `/F` is unconditional.

## D-027 - The panel comes up with the run, and what that costs (2026-08-20)

Watching a run in a browser needed two terminals and two commands: `milestoner run` in one,
`milestoner serve` in the other. `milestoner run --serve` collapses that. The server lifecycle -
build, listen, hand back a URL and a close function - is now one function both callers use, so
`serve` and the attached panel cannot drift apart. Three questions had to be answered before this
was safe to ship.

**`--write` is allowed, and the start-run control is what goes.** The panel's controls can start a
runner. With a runner already draining the same directory that is two processes writing one
`state.json`, which is the lost-update shape
[D-022](#d-022---statejson-writes-are-serialised-across-processes-2026-08-19) exists to prevent, and
serialising the writes does not make two runners on one run state sensible. Refusing `--write`
outright was the other option and it costs too much: steer, unblock, attend and above all kill are
the reason to have the panel open at 3am in the first place, and `kill` in particular is the
supervisor's rule 4 path, which is specified against a live runner and works exactly as intended
there. So the attached panel keeps every control and loses one: `/api/run/start` answers `409` with
"a second one would be two runners on one state.json", and the page does not draw the button. The
refusal is server-side, not a hidden button: the page is one client of an HTTP API, and an API that
relies on its own page to stay honest is not one.

**A busy port moves the panel; it never fails the run.** The run is the point and the panel is the
accessory, so `EADDRINUSE` on the requested port falls back to an ephemeral one and says so:
`port 4400 is already in use - the panel is on port 51823 instead`. The alternative was to carry on
with no panel at all, which is worse for the case that makes this happen: a second run on a machine
where the first one already holds 4400. Nothing about the panel's address was ever memorable - the
URL carries a generated key and has to be copied from the output whatever the port - so moving it
costs the user nothing they had. It does break a pre-arranged SSH forward, which is the one real
cost and the reason the fallback is announced rather than silent. `milestoner serve` keeps the
opposite behaviour and still exits `1` with "pick another with --port": there the panel *is* the
command, and quietly landing somewhere else is not a service to anyone. If the panel cannot come up
at all, the run continues and the failure is a warning, never an exit code.

**`--open` is not offered.** The URL is the credential: it carries the key that authorises steering,
unblocking, killing and running the environment adapter. Handing it to a browser writes a live
credential into that browser's history, and into whatever that browser syncs to other devices and to
a vendor. `report --open` is not the same case and is unaffected - it opens a local file whose path
contains no secret. `milestoner run --serve --open` therefore exits `1` and says why, rather than
ignoring the flag: a user who typed it wants the browser open and needs to know it will not happen
and what to do instead. Copying one URL out of the terminal is the whole difference, and it keeps
the key in one place the user chose.

## D-028 - The lock carries its holder from the first instant, because D-022 broke empty locks on sight (2026-08-20)

D-022's lock could be broken by the process that had just taken it. `openSync(file, "wx")` was the
atomic test-and-set, but it creates the file *empty*; the holder's pid landed on the next line. For
that instant the lock existed with no contents, and `breakIfStale` treated "unreadable or empty" as
nothing worth waiting for and deleted it on sight. The reasoning was inverted: an empty lock file is
the signature of a lock acquired microseconds ago, which is the one that most needs respecting. A
contender deleted it, took `wx` itself, and two processes ran the read-modify-write D-022 exists to
serialise; one update was silently lost. CI caught it once as
`concurrent registration from several processes loses no entry` on `ubuntu-latest / node 20` (run
32420272395, `run-1` lost out of six) - green on the other seven jobs, because the window is
microseconds and the suite mostly failed to lose. Three decisions close it.

**The lock becomes visible with its payload already in it.** The payload is written to a temp file
first and `linkSync(tmp, lockfile)` publishes it: a hard link lands whole or fails with `EEXIST`,
so on this path no contender can ever observe an empty lock. Rejected: keeping `wx` and writing
faster, which shrinks the window without closing it, and `renameSync`, which overwrites an existing
destination and so is not a test-and-set at all. On a filesystem without hard links (FAT and some
network shares), the first failed link drops the process to the old `wx`-then-write for good, and
correctness there rests on the next paragraph.

**A lock that cannot be read is honoured for a grace window, not deleted.** The window is keyed on
the lock file's own mtime, because the contender is a different process on each attempt and the
filesystem is the only party that saw the file appear; no contender has to remember anything across
attempts. Three seconds, not something tighter, because FAT-family filesystems round mtime to whole
seconds and the fallback path above is exactly where they show up. The cost is bounded and rare: a
holder that crashes inside the microsecond gap between `wx` and its write delays contenders by three
seconds, once, and only on filesystems where the fallback runs at all.

**The 5-second steal-and-run-unlocked fallback is gone.** D-022 said a run that stops because a lock
never cleared is worse than the race, and after `WAIT_MS` it deleted whatever lock existed and ran
the critical section unlocked - a second, deliberate way for two processes to end up inside. The
premise was wrong once the stale rules are trusted to do their job: a dead holder is broken at once,
a live-but-wedged one when its `at` passes 30 seconds, an unreadable lock when its mtime passes the
grace, so no failure that can be named leaves the lock standing for a minute. The deadline is now 60
seconds and reaching it means something the rules cannot name; only then does the caller proceed
unlocked, and it leaves the lock file in place, because deleting it is what would let a third
process in. Release is ownership-checked for the same reason: a holder that was broken as stale must
not, on finishing, delete the lock its breaker has since taken.

## D-029 - A transcript with nothing in it is a crash at any duration (2026-08-20)

`classifyInfraFailure` refused to look at the transcript size once a session had outlived
`infra.deathSeconds`, so an agent that worked for fifteen minutes and then died leaving fifteen
bytes was graded `incomplete` and charged. That happened to M03 of the v0.5 run: the session pushed
its branch, got a green eight-job matrix, then exited 0 with a transcript reading `Execution error`
and no `result.json`, and the engine charged one of three attempts for a milestone that had already
succeeded. The duration bound was guarding the instant-death rule, which is its job, and also
deciding whether a tiny transcript counts as evidence, which was never its job. Three decisions
separate the two.

**A second, lower threshold, not a dropped bound.** `infra.crashTranscriptBytes` (default 100 B)
marks the line below which a session that wrote no `result.json` is a `crash` whatever the clock
says; `tinyTranscriptBytes` (500 B) keeps its existing job inside `deathSeconds`. The bound is not
dropped from the 500-byte rule because 500 bytes is calibrated for a session that barely started: a
real failing session can end on a short closing message well under 500 bytes, and refunding those
would switch the attempt budget off for every quiet failure. Below 100 bytes there is no verdict,
no diagnosis and not one sentence of narration, so there is nothing a grader could charge. An agent
failure that legitimately says almost nothing is therefore refunded as a `crash` and retried, and
the one shape that small ever observed (`Execution error`, 15 bytes) is precisely the crash the
rule exists to refund.

**Above the line, no refund.** A session that ran an hour and left 4 KB with no `result.json` is an
agent that demonstrably ran and did not close, which is what the attempt budget measures: it stays
`incomplete`, "no result.json written", and is charged. The boundary is the byte count alone,
decided rather than accidental: below `crashTranscriptBytes` the transcript decides, above it the
existing rules decide (patterns and limits inside `deathSeconds`, the grader otherwise). Rejected:
a duration-and-size heuristic ("ran long and wrote little"), which needs two numbers whose product
means nothing and lands exactly on the quiet legitimate failures the budget exists for.

**The ceiling is the existing one, `infra.maxRetries`.** Thirty consecutive infrastructure failures
end the run with exit 1, and any session that produces a gradable verdict resets the counter. That
is enough because the refund requires all of: no supervisor kill (checked before classification
runs), no `result.json`, and under 100 bytes of output. A genuinely failing milestone exceeds 100
bytes with its first tool call, so reaching the ceiling means an agent that died thirty times in a
row without printing a line, which is an infrastructure condition, the thing the refund is for. The
worst case the rule adds is thirty refunded sessions and thirty short waits before
`infra-exhausted`, the same ceiling every other infra rule already had. Rejected: a separate,
smaller cap for crashes, a knob that distinguishes two flavours of the same "not the milestone's
fault".

## D-030 - Re-init refuses another run's protocol, and tags lose their slash (2026-08-20)

`milestoner init` writes the protocol with `writeFileIfMissing`, so scaffolding a new run over an
existing `.milestoner/` kept the old file, previous run's name included. This repository proved the
cost: `.milestoner/protocol.md` told sessions to tag `v04-plugin/<milestoneId>` while the run was
`v05-debt`, every v0.5 session read it, all of them followed the plan document instead, and nothing
anywhere reported that two authority documents disagreed about a concrete instruction. Three
decisions close it.

**A protocol naming a different run stops `init` cold.** It exits 1 before writing anything, names
both runs, and asks the user to bring the file in line - the run name in the header, the tag line
in its Git section - or delete it for a fresh template. The cost is one manual step on every
re-init over a finished run, paid by exactly the person who has to confirm the old rules still
apply to the new one. Rejected: warning and carrying on, because a warning above init's "Next:"
block is precisely the silence being closed - v0.5 showed that a wrong instruction survives being
technically visible; and rewriting only the run references, which edits a hand-owned file by
pattern match and fails badly on a rephrased header or on prose that mentions the old run
legitimately. A protocol whose header names no run at all cannot hand a session another run's
rules, so it is kept, with a warning that `init` cannot check it.

**The run name stays baked into the protocol body.** A protocol that said "this run" could never go
stale, but it would stop being a self-contained document a person can read without context, and the
tag instruction cannot be rendered at all without the name. Staleness is instead caught at the only
moment it can arise - an `init` over an existing file - by the refusal above.

**Tags are `<run>-<milestoneId>`, and the existing tags stay.** The old scheme's tag was the same
string a session naturally picks as a branch name: `v05/M03` existed as both, and
`git push origin v05/M03` failed with `src refspec matches more than one`. Tags now carry no slash
while the workflow's branches (`<run>/<id>`, `wip/<id>`) keep their slash namespace, so the two
cannot share a name; M06 had already tagged `v05-debt-M06` in exactly this shape before the scheme
was written down. `v05/M01` through `v05/M05` and `v0.5.0` are left alone: they are the recorded
rollback points cited by `state.json` evidence and the execution log, and renaming published tags
would rewrite pushed history a second time in one day to repair names nothing generates any more.

## D-031 - Three layers, and the middle one is the only one the engine writes (2026-08-21)

Recorded here on 2026-08-21, when `BRIEF.md` was removed. The framing predates every decision in
this file and was never written down as one, because it arrived as the genesis document's
architecture section rather than as a question anyone had to answer. Three documents cite it, so it
needs to survive the file it came from.

**The engine is generic, the protocol is templated, and milestone prompts are always hand-written.**
The engine is the product: state machine, session runner, infra-failure handling, supervisor
playbook, liveness heuristics, adapter interface. It knows nothing about any particular project. The
project protocol sits between them, generated once from a template by `init` and then owned and
edited by the user: commit conventions, where evidence goes, testing rules, the session ritual.
Milestone prompts are the third layer and the engine never generates them, silently or otherwise.

**That third layer is the deliberate friction, not an unfinished feature.** Writing an objective,
its tasks, its acceptance criteria and its exit by hand is what makes the evidence gate mean
anything: a criterion nobody wrote cannot be a criterion anybody checks. A generated prompt would
produce exactly the vague specification the gate exists to reject, and the run would pass its own
grading while building the wrong thing. It is also the stated difference from task-generating
loops, where an agent decides its own next task and therefore its own definition of done.

Rejected, and still rejected: a flow builder that generates prompts from boxes and arrows. The
argument for revisiting it, and the narrower version that edits ordering and titles while the prompt
files stay hand-written text, are in `docs/NEXT.md`. Superseding this decision is what that would
require, and it has not been superseded.

## D-032 - A planner skill that interviews, and `skill install` learns names (2026-08-21)

The bundle gains a second skill, `milestoner-planner`, and the question it had to answer first is
whether it survives D-031. It does, because the boundary D-031 draws is about who supplies the
substance, not who types the markdown. The engine still writes no prompts. The planner is an
authoring assistant with the user in the loop at both ends: it interviews ("what would you check by
hand to believe this is done?"), proposes the milestone breakdown as a table, and writes nothing to
disk before the user approves it. Its hard rules forbid inventing an acceptance criterion the user
has not confirmed - a criterion nobody meant is a criterion nobody checks - and its final checklist
enforces what the `milestoner lint` experiment in `docs/NEXT.md` item 5 would: at least one
criterion per milestone, each naming a written artifact, an exit section, one gate per milestone,
prompts self-contained. What D-031 rejected - a builder generating specifications on its own -
stays rejected.

Boundaries the planner inherits rather than invents: it may edit `state.json` only for milestone
titles, only while no runner is alive and the milestone is pending with zero attempts (D-006
otherwise stands); it reads `status --json` before touching anything, and a run in flight stops it;
and it never launches `milestoner run` itself - starting an unattended run spends the user's time
and tokens, so the command is handed over, not executed. `src/templates/planner.test.ts` pins the
approval-before-write sentence, the guard on `state.json`, and that the human-only commands are
never spelled runnable.

Distribution follows D-017 unchanged: one source in `src/templates/planner.ts`, shipped twice
(generated into `skills/` for the plugin, written by the CLI), drift-guarded by a test.
`milestoner skill install` now takes an optional name (`supervisor`, `planner`, or the full skill
names); with none it installs everything, and `--print` requires a name now that there are two. The
plugin ships a fifth command, `/milestoner-plan`, which passes D-018's admission test the same way
`/milestoner-init` does: in-session file work, not long-lived, not a decision reserved to a human
or to the supervisor.
