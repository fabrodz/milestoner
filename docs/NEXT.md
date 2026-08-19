# What to do next

Written 2026-08-19, after v0.3 and the rename to pulseflow. Supersede this file rather than editing
it once the validation below has happened.

## The recommendation: dogfood one milestone with `--once`

The most load-bearing assumption in the whole design is D-006: the session writes
`.pulseflow/result.json` and the engine grades it. That is also a **departure from the
implementation that was actually proven** - in the original overnight runs the session edited
`state.json` directly, and that is what survived 10.5 hours in production. This reimplementation has
never executed one real milestone with a real agent.

Everything else rests on the same untested ground: the wording of the generated kickoff, the
protocol template, and whether evidence lines come back verifiable or perfunctory. None of that is
provable with scripted agents, which do exactly what they are told.

The cheap validation is not a five-milestone overnight run. It is one milestone, `--once`, watched:

```sh
pulseflow run --milestone M01 --once
pulseflow status
cat .pulseflow/results/M01-attempt1.json   # the raw claim, before grading
```

### Candidate milestone: bring `docs/GUIDE.md` to v0.3

Work that is needed anyway, with crisp acceptance criteria, verifiable by reading and grepping, and
unable to break the engine if the session goes wrong. Known gaps in that file:

- It says **v0.2** throughout, including the "Limits of v0.2" section, which still lists the HTML
  report and the steering file as not built. Both shipped in `3b0bbc0`.
- The command reference is missing `pulseflow steer` and `pulseflow report`.
- The grading table says a session killed by `pulseflow kill` is *always* graded incomplete. If that
  session had already written a valid `result.json`, it is graded on that result. Rare, but the word
  "always" is wrong.
- `npm install -g pulseflow` is documented but nothing is published yet.

### What this validates

- The full `result.json` contract, end to end, with a real agent.
- Whether evidence comes back as something checkable or as a paraphrase of the task.
- Whether the protocol template produces an orderly session.
- Whether the evidence gate downgrades when it should.
- Whether the configured `liveness` paths catch a silent writing phase.

### What it does not validate

A test gate that fails and forces iteration, a long session, a real infrastructure failure, or the
supervisor against a live run. Those need a code milestone and an actual multi-hour run, which is
the step after this one if it goes well.

### The real cost

Not the session. About fifteen minutes writing `.pulseflow/protocol.md` for this repo (how tests
run, where evidence goes, commit conventions) and the milestone prompt. That setup is reused by
every run afterwards.

## Rejected for now

- **Publish to npm.** Premature for an engine that has never run a milestone.
- **v0.4** (plugin packaging, a second agent behind the config string). More floor on unvalidated
  ground.
- **Updating the guide by hand.** Faster, but it spends the one well-specified task available for
  proving the product.

## Small things pending, none blocking

- No `LICENSE` file, though `package.json` declares MIT.
- The Unity adapter lives only in `reference/unity-attend.ps1`; the docs tell the reader to copy it
  into a project by hand. Shipping it as a first-class example is a v0.2 leftover.
- The repository directory is still named `runpulse`. Cosmetic.
- `docs/GUIDE.md` was not written in this session's normal flow and has never been reviewed line by
  line by its author; it was read and fact-checked against the code on 2026-08-19, and the one real
  discrepancy it exposed (the interrupt semantics) was fixed in `3ae7b68`.

## Product goals not yet on the roadmap

Two goals stated on 2026-08-19. Neither is a feature to bolt on: both are mostly about removing
assumptions that are currently baked into defaults and into code paths that have never run.

### Any agent, not just Claude Code

The seam already exists (D-005): `agent.command` plus an `agent.args` template, and the engine
never reads an exit code, so a different agent is meant to be a config change. What is actually in
the way:

- **The prompt can only be delivered as an argument.** `{{kickoff}}` is substituted into `args`.
  An agent that expects its prompt on stdin, or as a file path, cannot be configured at all. This
  needs a `promptDelivery: "arg" | "stdin" | "file"` option, and it is the one real engine change
  of the three.
- **The infrastructure heuristics are Claude-worded.** `usageLimitPatterns` defaults to Claude's
  phrasing, and `secondsUntilReset` parses Claude Code's literal `resets 3:00pm`. Both are
  configurable, but a user swapping agents inherits wrong defaults silently: the run would spend
  attempts on what is really a quota wall. Per-agent presets, not per-user guesswork.
- **The default args carry `--dangerously-skip-permissions`**, which is Claude-specific and
  meaningless elsewhere.
- **No agent other than Claude Code has ever been launched.** Everything above is reasoning from
  the code, not from an observed failure.

One distinction to keep honest: pulseflow drives **agent CLIs**, not model endpoints. An agent must
be able to read files, run commands and write `result.json`. Ollama is a model server, not an
agent, so "works with ollama" means "works with an agent harness pointed at a local model", not a
config line. Making pulseflow itself the agent is a different product.

Done looks like: a `promptDelivery` option, a small set of tested per-agent presets shipped with the
engine (each carrying its own infra patterns), and at least one non-Claude agent driven through a
real milestone end to end.

### Windows, macOS and Linux

The code is written to be portable and has only ever run on Windows. Concretely:

- **The POSIX kill only reaches the direct child.** Windows uses `taskkill /T /F`, which kills the
  process tree; POSIX sends `SIGTERM` to the child alone, and the process is not spawned
  `detached`, so there is no process group to signal. If the agent CLI is a wrapper script, the
  real process survives a `pulseflow kill` on macOS and Linux, which quietly breaks playbook rule 4.
- **The whole non-Windows spawn path is untested.** `resolveExecutable` returns early on POSIX and
  the `.cmd` shim branch never fires, so the code is simpler there - but simpler is not the same as
  verified.
- **No CI.** The test suite already spawns real child processes (`runner.stop.test.ts`), so a
  three-OS matrix would exercise the parts that actually differ, cheaply.
- Paths recorded in `state.json` history and `pulse.json` use the host separator, so a run moved
  between machines reads inconsistently. Cosmetic.
- The only environment adapter that exists is PowerShell, which is inherent to what it does.

Done looks like: CI on `windows-latest`, `macos-latest` and `ubuntu-latest`; the POSIX kill fixed to
signal a process group; and the README stating which combinations have actually been exercised
rather than which ones ought to work.

### Ordering

The three-OS CI is the piece worth doing immediately and in parallel with everything else: it is
cheap, it protects every later change, and it does not depend on the validation above. The agent
presets are worth less until the engine has been proven once with the agent that already works -
otherwise a failed run leaves two suspects instead of one.

## Idea under evaluation: a web UI

Proposed 2026-08-19: a web interface to monitor the runs that are executing, their milestones and
status, with the ability to build flows.

That is three separate things with very different costs, and they should be decided separately.

### 1. Live monitoring (read-only)

Cheap, and already half built. `pulseflow status --json` is a complete snapshot by design (D-011)
and `report.html` already renders milestones, evidence, diagnoses, the attempt history and a
wall-clock timeline. A live view is that renderer plus a local server that re-reads the same files.

The honest question is who watches it. The product's whole thesis is that a supervisor acts so a
human does not have to: if the supervisor works, you are asleep and the live view has no audience.
Its real value is narrower but genuine - the first runs on a new project, while you are still
deciding whether to trust it, and the moment you walk back to the machine and want the state at a
glance without a terminal.

Note that D-004 already deferred exactly this ("live web view later") and the report was chosen
instead, because "what happened overnight" was the question that mattered.

### 2. Several runs at once

This is the part that is not a UI feature at all. Today a run is strictly one per project
directory, and the CLI finds it by walking up from the working directory. There is no notion of
"the runs on this machine", so there is nothing for a dashboard to list.

The missing primitive is a machine-level registry - runners registering their project path and pid
somewhere like `~/.pulseflow/runs.json`, and pruning themselves on exit. That is useful on its own,
before any UI: `pulseflow runs` listing every live run with its milestone and liveness verdict is a
CLI command worth having regardless.

Build the registry first. A dashboard without it can only ever show the directory it was started
in, which is what `status` already does.

### 3. Building flows

This one is a product-identity decision, not a feature, and it deserves an explicit answer before
any work.

Milestone prompts are hand-written on purpose. The engine never generates them silently; that is
the deliberate friction, and it is the stated difference from Ralph's PRD-and-task generation. A
flow builder that assembles milestones from boxes and arrows would produce exactly the vague specs
the evidence gate exists to catch: acceptance criteria that name no evidence, milestones with two
unrelated gates, work with no verifiable end state.

There is a defensible version: a UI that helps you *see* an existing run's shape - dependencies,
ordering, which milestone owns which acceptance criterion - and edits `state.json` ordering and
titles, while the prompt files stay hand-written text. That is a viewer with light editing, not a
flow builder, and it does not touch the decision above.

If the goal really is authoring flows in a GUI, that is a different product from the one BRIEF.md
describes, and it should supersede that decision in writing rather than arrive as a screen.

### Security, if any UI ever gets a write path

A local server that can launch or kill agent sessions is remote code execution by design - the
default agent args include `--dangerously-skip-permissions`. Bind to loopback only, require a token
generated per process, and keep the write surface to the same narrow set the supervisor has
(`kill`, `attend`, `run`). A read-only view has none of this problem, which is another argument for
shipping that first.

### Read

Worth doing, in this order, and none of it before the engine has been proven on a real milestone:
the multi-run registry as a CLI command, then a read-only live view reusing the report renderer,
then a decision in writing about flow authoring before any editing UI exists.
