# pulseflow user guide

Everything you need to plan, launch and babysit an autonomous run. Written for the person who is
going to leave a coding agent working for ten hours and wants to find something real in the morning.

Applies to **v0.2**: the engine (`init`, `run`, `status`, `unblock`) plus the active supervisor
(`skill install`, `kill`, `attend`). Where a behaviour is planned for a later version it says so.

- [What pulseflow actually does](#what-pulseflow-actually-does)
- [When to use it, and when not to](#when-to-use-it-and-when-not-to)
- [Install and requirements](#install-and-requirements)
- [The mental model](#the-mental-model)
- [Quickstart: your first run](#quickstart-your-first-run)
- [The .pulseflow directory](#the-pulseflow-directory)
- [Writing the protocol](#writing-the-protocol)
- [Writing milestone prompts](#writing-milestone-prompts)
- [Command reference](#command-reference)
- [Configuration reference](#configuration-reference)
- [How the engine grades a session](#how-the-engine-grades-a-session)
- [Infrastructure failures](#infrastructure-failures)
- [The pulse: is this run alive?](#the-pulse-is-this-run-alive)
- [The supervisor](#the-supervisor)
- [Environment adapters](#environment-adapters)
- [Use cases](#use-cases)
- [Recipes](#recipes)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Limits of v0.2](#limits-of-v02)

## What pulseflow actually does

You split the work into milestones and hand-write a spec for each one. `pulseflow run` then loops:

1. Pick the first milestone that is not `done`.
2. Launch a **fresh** headless agent session (by default `claude -p ...`) with a kickoff message that
   points it at the protocol and at that milestone's prompt file.
3. Wait. Print a heartbeat line every 60 seconds.
4. When the session exits, read `.pulseflow/result.json` (the session's own verdict), **grade it**,
   merge the graded result into `state.json`, and archive the raw claim.
5. Repeat until the run is complete, a milestone is blocked, or attempts run out.

The value is in step 4, and in what happens when a session dies for reasons that have nothing to do
with the work. The engine never trusts an exit code, never trusts a "done" without evidence, and
never spends a retry on a usage limit.

On top of that, the **supervisor** is a Claude session on a ten-minute loop that watches the run and
intervenes inside a bounded playbook: unstick a wedged environment, kill a hung session, relaunch a
dead runner, escalate a real block.

```mermaid
flowchart TD
  A[pulseflow run] --> B{next milestone<br/>not done?}
  B -- none left --> Z[run complete, exit 0]
  B -- blocked --> Y[print diagnosis, exit 2]
  B -- pending --> C[launch fresh agent session]
  C --> D[session exits]
  D --> E{wrote result.json?<br/>ran long enough?}
  E -- no, died fast --> F[infra failure:<br/>wait, attempt NOT consumed]
  F --> B
  E -- yes --> G[grade result.json]
  G -- done + evidence --> H[status = done]
  G -- done, no evidence --> I[incomplete: attempt++, retry]
  G -- blocked + diagnosis --> Y
  G -- no result / bad result --> I
  I --> B
  H --> B
```

## When to use it, and when not to

Use it when:

- The work is **long** (hours, not minutes) and splits into 3-15 chunks with a clear finish line each.
- Each chunk has an **objectively verifiable** end state: a test count, a build that passes, a file
  that exists, a screenshot.
- You will not be watching. You want to sleep and read a report.
- The project lives on your host machine and cannot be containerised (a Unity or Unreal editor, a
  connected device, a licensed tool).

Do not use it when:

- The task is one prompt long. Just talk to the agent.
- Success cannot be checked without you looking at it. pulseflow cannot grade taste.
- The acceptance criteria are still unknown. Explore first, then write milestones.

## Install and requirements

```sh
npm install -g pulseflow
# or, per project:
npx pulseflow init
```

Requirements:

- **Node 20+**.
- An agent CLI on `PATH`. The default is Claude Code (`claude`), authenticated and working in the
  project directory. Test it first: `claude -p "print the name of this repo"`.
- A git repository is not required but strongly recommended: the default protocol tags every green
  milestone, which gives you rollback points.
- For the supervisor, a Claude Code session you can leave open at the project root.

Works on Windows, macOS and Linux. On Windows the runner detects an npm `.cmd` shim and quotes
arguments the way `cmd.exe` needs, so kickoff prompts containing `&`, `|` or quotes survive intact.

## The mental model

Seven rules explain almost every behaviour you will see.

**1. One fresh session per milestone.** No long context, no drift, no "as we discussed earlier". The
session starts blank and reads its way in: protocol, then state, then its milestone prompt.

**2. Files are the memory.** Everything that must survive a session lives on disk. The engine owns
`state.json`; the session owns `execution-log.md`, `decisions.md` and one drop box, `result.json`.
The session is explicitly told not to edit `state.json`.

**3. Evidence is a gate.** `"status": "done"` with an empty `evidence` array is downgraded to
incomplete and retried. One evidence line per acceptance criterion, each pointing at something
written down: a test count, a log path, a screenshot, a commit hash.

**4. Blocked is a handoff, not a failure.** To block, a session must write a diagnosis: the exact
symptom, everything it tried, and the single clearest action for you. `pulseflow status` prints that
diagnosis; `pulseflow unblock <id>` puts the milestone back in play once you have fixed the cause.

**5. Infrastructure is not failure.** A session that dies in 20 seconds with an empty transcript hit
a usage limit, an auth prompt or a network error. That does not consume an attempt. If the agent
announced a reset time, the engine waits until then instead of guessing.

**6. Liveness comes from side signals.** A headless `claude -p` flushes its transcript only when it
exits, so a silent log proves nothing. The engine watches the paths you list in `liveness`: source
directories, test-result files, tool logs. Their mtime is the proof that work is happening.

**7. The engine keeps a run correct; the supervisor keeps it alive.** Two jobs, two processes. The
engine grades and retries. The supervisor decides whether the run is advancing at all, and acts
inside a narrow, logged playbook. See [The supervisor](#the-supervisor).

## Quickstart: your first run

### 1. Scaffold

```sh
cd /path/to/your/project
pulseflow init --run checkout-v2 --milestones 4
```

```
  prompts/M01.md
  prompts/M02.md
  prompts/M03.md
  prompts/M04.md
  config.json
  state.json
  protocol.md
  .gitignore
  execution-log.md
  decisions.md
  supervisor-log.md
== initialized .pulseflow/ for run "checkout-v2"

Next:
  1. Edit .pulseflow/protocol.md - replace every TODO with this project's rules.
  2. Write .pulseflow/prompts/M01.md and friends - objective, tasks, acceptance criteria, exit.
  3. Set the titles in .pulseflow/state.json to match.
  4. Point "liveness" in config.json at the paths that prove work is happening
     (source dirs, test-result files, tool logs). The transcript is never one.
  5. pulseflow run

To supervise a long run, install the supervisor skill and loop it:
  pulseflow skill install
  /loop 10m Use the pulseflow-supervisor skill to perform one supervision cycle.
```

`--run` defaults to the directory name, slugified. `--milestones` defaults to 3. Existing files are
never overwritten; `--force` overwrites `config.json` and `state.json` only.

### 2. Fill in the protocol

Open `.pulseflow/protocol.md` and replace every `TODO`. This is the file every session reads first, so
it is where your project's non-negotiables go: how tests run, where evidence is written, commit
conventions, what "the environment is reachable" means here. Ten minutes here saves three retries.

### 3. Write the milestone prompts

`.pulseflow/prompts/M01.md` and friends. This is the actual work specification and pulseflow never
generates it for you. See [Writing milestone prompts](#writing-milestone-prompts).

### 4. Set the titles and the liveness list

Titles in `state.json` are what `status` prints, so make them readable:

```json
{
  "run": "checkout-v2",
  "milestones": [
    {
      "id": "M01",
      "title": "Cart schema + migration",
      "prompt": "M01.md",
      "status": "pending",
      "attempts": 0,
      "evidence": [],
      "history": []
    }
  ]
}
```

And in `config.json`:

```json
"liveness": ["src", "tests/results/latest.json"]
```

### 5. Run

```sh
pulseflow run
```

```
== M01 - Cart schema + migration  (attempt 1/3)
   prompt     .pulseflow/prompts/M01.md
   transcript .pulseflow/logs/M01-20260818-2312.log
     M01 running 1m, newest signal 12s old (src/db/schema.ts)
     M01 running 2m, newest signal 4s old (src/db/migrations/0007_cart.sql)
   session ended (exit 0, 8m, 41233 B transcript)
++ M01 DONE - 3 evidence line(s)
== M02 - Cart API endpoints  (attempt 1/3)
...
```

Leave it running in a terminal, or in `tmux`/`screen`/a detached shell, overnight.

### 6. Check on it from another terminal

```sh
pulseflow status
```

```
checkout-v2  [##>.]  2/4 done
  .pulseflow/state.json

  done     M01   Cart schema + migration att 1/3 ev 3
  done     M02   Cart API endpoints att 1/3 ev 4
  running  M03   Checkout UI att 1/3
  pending  M04   E2E happy path

pulse
  runner pid 24188 on M03 attempt 1, agent pid 24512
  last event  running 34m (12s ago)
  session     34m
  liveness    alive - src/app/checkout/page.tsx touched 41s ago
```

### 7. Optionally, put a supervisor on it

```sh
pulseflow skill install
```

Then in a Claude Code session at the project root:

```
/loop 10m Use the pulseflow-supervisor skill to perform one supervision cycle.
```

That is the whole loop. Everything below is detail.

## The .pulseflow directory

```
.pulseflow/
  config.json          you own it: agent command, attempts, infra rules, liveness watch list
  state.json           the engine owns it: never edit while a run is in progress
  protocol.md          you write it: shared rules every session reads first
  prompts/M01.md       you write it: the actual milestone specs
  result.json          transient drop box: the session's verdict for the current attempt
  results/             archived raw claims, one per attempt (M01-attempt2.json)
  logs/                session transcripts (M01-20260818-2312.log)
  pulse.json           live runner heartbeat, deleted when the runner exits
  kill.json            transient marker written by `pulseflow kill`
  run-log.md           append-only engine events
  supervisor-log.md    append-only interventions
  execution-log.md     the agent's own narrative log
  decisions.md         autonomous decisions the agent made
```

| File | Written by | Read by | Commit it? |
| --- | --- | --- | --- |
| `config.json` | you | engine | yes |
| `protocol.md`, `prompts/` | you | every session | yes |
| `state.json` | engine | engine, sessions, you | yes, it is the run's history |
| `execution-log.md`, `decisions.md` | sessions | you, the next session | yes |
| `run-log.md` | engine | you, the supervisor | yes |
| `supervisor-log.md` | supervisor | you, the next supervision cycle | yes |
| `result.json`, `results/`, `logs/`, `pulse.json`, `kill.json` | sessions / engine | engine, you | no, `init` gitignores them |

`run-log.md` is the flight recorder. One line per engine event:

```
2026-08-18T23:12:04.881Z | M01 | launch | attempt 1/3
2026-08-18T23:20:41.223Z | M01 | done | attempt 1, 517s
2026-08-18T23:21:00.004Z | M02 | launch | attempt 1/3
2026-08-18T23:21:29.610Z | M02 | infra:usage-limit | waiting 47m for the announced reset; wait 2843s
```

`supervisor-log.md` is the same idea for interventions:

```
2026-08-19T02:31:10.442Z | rule 4 | kill agent pid 24512 on M03: no signal for 31m | killed
```

## Writing the protocol

`init` writes a template full of `TODO` markers. The sections that matter most:

**Session start ritual.** What the session must read before doing anything, and how it verifies the
environment is reachable. If the environment is dead, the session should block immediately rather
than burn an hour. Example for a web project:

```markdown
3. Verify the environment: `npm ci` succeeds and `npm run dev` answers on http://localhost:3000
   within 60s. If it does not, write a `blocked` result with symptom `environment-unreachable`.
```

**Testing.** How tests are run and where results land. Point this at a file the agent can quote as
evidence, and add that file to `liveness` in `config.json`:

```markdown
- `npm test -- --reporter=json --outputFile=tests/results/latest.json`. Record pass/fail counts in
  the execution log and read the file back to confirm.
```

**Descope authority.** The one rule that prevents both stalling and cheating: the session may
simplify cosmetic details, and must log them, but may not descope a core acceptance criterion.

**Git.** Commit per logical step, tag each green milestone `<run>/<milestoneId>`. Those tags are your
rollback points: `git reset --hard checkout-v2/M02`.

**Session end.** Append to the execution log, commit, write `result.json`, exit. The template already
spells out the JSON contract for both `done` and `blocked`.

## Writing milestone prompts

Milestone prompts are hand-written, always. This is the deliberate friction in the product: the
engine will not silently invent your specification.

A good milestone is one **session** of work (roughly 30-90 minutes for a capable agent), has an end
state you can check without opening the code, and does not depend on a decision you have not made.

Filled-in example, `.pulseflow/prompts/M02.md`:

```markdown
# M02 - Cart API endpoints

## Objective

At the end of this milestone the app exposes a working cart API (`POST /api/cart/items`,
`PATCH /api/cart/items/:id`, `DELETE /api/cart/items/:id`, `GET /api/cart`) backed by the schema
built in M01, with the pricing rules from `docs/pricing.md`. Nothing renders it yet; that is M03.

## Context

- Touches `src/app/api/cart/`, `src/server/cart/`, and `src/db/schema.ts` (read only, M01 owns it).
- `docs/pricing.md` is authoritative for discounts. Do not reimplement rules that live there.
- Out of scope: auth (already done), UI, checkout and payment.

## Tasks

1. Service layer in `src/server/cart/service.ts`: add, update quantity, remove, read.
2. Route handlers with zod input validation and typed error responses.
3. Unit tests for the service, integration tests for the routes against a test database.
4. Update `docs/api.md` with the four endpoints.

## Acceptance criteria

- **AC1** - The four endpoints exist and answer the documented status codes.
  (evidence: integration test names and count in `tests/results/latest.json`)
- **AC2** - Quantity <= 0 removes the line; quantity over stock returns 409.
  (evidence: the two test case names)
- **AC3** - Totals match the three worked examples in `docs/pricing.md`.
  (evidence: test names, one per example)
- **AC4** - `npm test` green, zero TypeScript errors.
  (evidence: pass/fail counts and `tsc --noEmit` output)

## Exit

- All acceptance criteria evidenced.
- Build clean, suite green.
- Committed and tagged `checkout-v2/M02`.
- `.pulseflow/result.json` written with `status: "done"` and one evidence line per criterion.
```

Rules of thumb:

- **Name the evidence inside the criterion.** "(evidence: test count in `tests/results/latest.json`)"
  removes any argument about what "done" means.
- **Say what is out of scope.** Autonomous agents expand scope when idle.
- **Point at authority documents** instead of restating them. The session reads files.
- **Never write "and also fix anything else you notice".** That is how a 40-minute milestone becomes a
  four-hour one and fails its gate.
- One milestone, one gate. If a milestone has two unrelated gates, it is two milestones.

## Command reference

Exit codes across all commands: `0` ok, `1` error, `2` blocked.

### pulseflow init

```sh
pulseflow init [--run <name>] [--milestones <n>] [--force]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--run <name>` | the directory name, slugified | Run name. Used in `state.json`, in the kickoff, and in the tag convention of the protocol template. |
| `--milestones <n>` | `3` | How many milestone skeletons to create (1-99). |
| `--force` | off | Overwrite an existing `config.json` and `state.json`. Prompts, protocol and logs are never overwritten. |

Adding a milestone later is a manual edit: create `prompts/M05.md` and append an entry to
`state.json`. That is intentional. `state.json` is a run's history, not a scratch file.

### pulseflow run

```sh
pulseflow run [--milestone <id>] [--max-attempts <n>] [--model <name>] [--once]
```

| Flag | Meaning |
| --- | --- |
| `--milestone <id>` | Work only this milestone instead of draining the run. Retries it until it is done, blocked, or out of attempts. |
| `--max-attempts <n>` | Override `maxAttempts` for this invocation only. |
| `--model <name>` | Appends `agent.modelArgs` (default `--model <name>`) to the agent command for this invocation. |
| `--once` | Stop after the current session, whatever the verdict. |

Run it from the project root or any subdirectory: pulseflow walks up looking for
`.pulseflow/config.json`, the way git finds `.git`.

**Ctrl-C once**: the runner stops after the current session finishes and leaves the milestone
`in_progress`; a later `pulseflow run` picks it up and starts a fresh attempt. **Ctrl-C twice**: the
agent session is killed immediately (exit 130).

Exit code: `0` complete or stopped, `2` blocked, `1` on error or after too many consecutive
infrastructure failures.

### pulseflow status

```sh
pulseflow status [--json]
```

Prints the milestone table, the diagnosis of any blocked milestone, and the pulse block. Exits `2` if
any milestone is blocked, which makes it usable in a shell check:

```sh
pulseflow status >/dev/null || notify-send "pulseflow needs you"
```

`--json` prints a machine-readable snapshot:

```json
{
  "run": "checkout-v2",
  "runComplete": false,
  "done": 2,
  "total": 4,
  "blocked": 0,
  "maxAttempts": 3,
  "milestones": [
    {
      "id": "M01",
      "title": "Cart schema + migration",
      "status": "done",
      "attempts": 1,
      "evidence": 3,
      "diagnosis": null,
      "finishedAt": "2026-08-18T23:20:41.223Z",
      "lastAttempt": {
        "attempt": 1,
        "startedAt": "2026-08-18T23:12:04.881Z",
        "endedAt": "2026-08-18T23:20:41.223Z",
        "seconds": 517,
        "exitCode": 0,
        "transcript": ".pulseflow/logs/M01-20260818-2312.log",
        "outcome": "done"
      }
    }
  ],
  "pulse": {
    "pid": 24188,
    "run": "checkout-v2",
    "milestoneId": "M03",
    "attempt": 1,
    "sessionStartedAt": "2026-08-18T23:42:02.110Z",
    "agentPid": 24512,
    "transcript": ".pulseflow/logs/M03-20260818-2342.log",
    "lastEvent": "running 34m",
    "lastEventAt": "2026-08-19T00:16:04.884Z",
    "runnerAlive": true,
    "agentAlive": true,
    "sessionSeconds": 2042,
    "lastEventSeconds": 12
  },
  "liveness": {
    "path": "src/app/checkout/page.tsx",
    "mtime": "2026-08-19T00:15:23.000Z",
    "ageSeconds": 41,
    "verdict": "alive"
  },
  "livenessConfigured": true,
  "attendConfigured": false,
  "recentEvents": ["2026-08-18T23:42:02.110Z | M03 | launch | attempt 1/3"],
  "recentInterventions": []
}
```

This snapshot is deliberately complete: it is the supervisor's whole view of the run, so one call
replaces any file parsing. `liveness.verdict` is `alive` / `slow` / `hung`, on the same thresholds as
the printed output.

### pulseflow unblock

```sh
pulseflow unblock <milestoneId> [--keep-attempts]
```

Sets the milestone back to `pending` and clears its diagnosis. Without `--keep-attempts` the attempt
counter resets to 0, which is what you want after fixing the underlying cause. With `--keep-attempts`
the milestone resumes on its remaining budget, which is what you want when you only nudged something
and are not sure it is fixed.

Clearing a block is always a human decision: the engine never does it on its own, and the supervisor
is forbidden from doing it.

### pulseflow skill install

```sh
pulseflow skill install [--global] [--force] [--print]
```

Writes the supervisor skill to `.claude/skills/pulseflow-supervisor/SKILL.md` in the project, or to
`~/.claude/skills/` with `--global`. `--print` dumps the skill text to stdout without writing
anything, which is how to read the playbook before installing it. It refuses to overwrite an existing
file without `--force`.

### pulseflow kill

```sh
pulseflow kill [--reason <text>] [--rule <n>]
```

Kills the **agent session**, never the runner. The runner sees the session end, grades it as
incomplete, consumes an attempt and relaunches with fresh context. That is the point of the
intervention: a session that has been going nowhere for half an hour is worth restarting, and it
should cost something.

Before killing, it writes `.pulseflow/kill.json`. Without that marker a session killed after a quiet
stretch would look like an infrastructure death (short, tiny transcript) and the engine would refund
the attempt, so the same intervention could repeat forever. The kill is also appended to
`supervisor-log.md`.

It refuses to act when there is no `pulse.json`, when the runner process is not alive, or when no
agent session is currently running. `--reason` records what you observed; `--rule <n>` tags the log
line with the playbook rule that fired.

### pulseflow attend

```sh
pulseflow attend [--seconds <n>] [--rule <n>]
```

Runs `environment.attendCommand`, the project's environment adapter, for `--seconds` (default
`environment.attendSeconds`, 120). It is the only environment intervention available and it never
touches project code. Fails with an explanation when no adapter is configured. See
[Environment adapters](#environment-adapters).

## Configuration reference

`.pulseflow/config.json`, created by `init`:

```json
{
  "run": "checkout-v2",
  "projectRoot": ".",
  "maxAttempts": 3,
  "retryDelaySeconds": 15,
  "agent": {
    "command": "claude",
    "args": ["-p", "{{kickoff}}", "--dangerously-skip-permissions"],
    "modelArgs": ["--model", "{{model}}"],
    "model": null,
    "env": {}
  },
  "infra": {
    "deathSeconds": 90,
    "tinyTranscriptBytes": 500,
    "maxRetries": 30,
    "usageLimitWaitSeconds": 600,
    "genericWaitSeconds": 60,
    "usageLimitPatterns": ["session limit", "usage limit", "rate limit", "429"]
  },
  "liveness": [],
  "environment": { "attendCommand": null, "attendSeconds": 120 }
}
```

| Field | Default | What it controls |
| --- | --- | --- |
| `run` | from `init` | Run name shown everywhere. |
| `maxAttempts` | `3` | Attempts per milestone before it is marked blocked. Raise for flaky work, lower for expensive models. |
| `retryDelaySeconds` | `15` | Pause after a non-`done` verdict, before the next session. |
| `agent.command` | `"claude"` | The executable. A different agent is a config change, not an engine change. |
| `agent.args` | see above | Argument template. Placeholders below. |
| `agent.modelArgs` | `["--model", "{{model}}"]` | Appended only when a model is set, in config or via `--model`. |
| `agent.model` | `null` | Pin a model for the whole run. |
| `agent.env` | `{}` | Extra environment variables for the session process. |
| `infra.deathSeconds` | `90` | A session shorter than this **and** with no `result.json` is a candidate infrastructure failure. |
| `infra.tinyTranscriptBytes` | `500` | Below this transcript size, a fast death is classified `instant-death`. |
| `infra.maxRetries` | `30` | Consecutive infrastructure retries before the runner gives up (exit 1). |
| `infra.usageLimitWaitSeconds` | `600` | Wait when a usage limit was detected but no reset time could be parsed. |
| `infra.genericWaitSeconds` | `60` | Wait after an `instant-death`. |
| `infra.usageLimitPatterns` | see above | Case-insensitive substrings searched in the last 4 KB of the transcript. Add your provider's wording here. |
| `liveness` | `[]` | Paths, relative to the project root, whose mtime proves work is happening. Directories are scanned recursively. |
| `environment.attendCommand` | `null` | Shell command line run by `pulseflow attend`, with a `{{seconds}}` placeholder. `null` disables the intervention. |
| `environment.attendSeconds` | `120` | Default duration passed to that command. |

**Placeholders** available in `agent.args`: `{{kickoff}}`, `{{promptFile}}`, `{{milestoneId}}`,
`{{projectRoot}}`, `{{pulseflowDir}}`, `{{model}}`. An unknown placeholder is left untouched so you can
see it in the log. `{{kickoff}}` is the generated instruction that points the session at the protocol,
the milestone prompt and the result contract; most setups only need that one.

**Choosing liveness paths.** Pick things that change *while* work happens, and only then:

| Project type | Good `liveness` |
| --- | --- |
| Web / backend | `["src", "tests/results/latest.json"]` |
| Monorepo | `["packages/api/src", "packages/web/src", "test-results"]` |
| Unity | `["Assets/Scripts", "Logs/editmode-latest.xml"]` |
| Data / notebooks | `["pipelines", "artifacts/last-run.json"]` |

Never list the transcript or a log the runner itself writes: it would look alive even when nothing is
happening. The recursive scan skips `node_modules`, `.git`, `.pulseflow`, `dist`, `Library`, `Temp`,
`obj`, `bin` and dot-entries, and goes six levels deep.

## How the engine grades a session

The session writes `.pulseflow/result.json` before exiting:

```json
{
  "milestone": "M02",
  "status": "done",
  "evidence": [
    "AC1: 14 integration tests named cart-api-* pass, tests/results/latest.json",
    "AC2: cases 'removes line on qty<=0' and 'returns 409 over stock' pass",
    "AC3: 3 pricing example tests pass, one per docs/pricing.md example",
    "AC4: 212 passed / 0 failed; tsc --noEmit clean; commit a4f9c1e"
  ],
  "notes": "Discount stacking was ambiguous; logged the decision in decisions.md."
}
```

What the engine does with it:

| What the session wrote | Verdict | Attempt consumed | Resulting status |
| --- | --- | --- | --- |
| `done` with at least one evidence line | done | no | `done` |
| `done` with empty or missing `evidence` | incomplete, warning printed | yes | `pending` (retry), or `blocked` if out of attempts |
| `blocked` with `symptom` and `userAction` | blocked | yes | `blocked` |
| `blocked` without a usable diagnosis | blocked, warning printed | yes | `blocked` |
| `incomplete` | incomplete | yes | `pending` (retry) |
| An unknown status value | incomplete, warning printed | yes | `pending` (retry) |
| A `milestone` id that does not match | ignored, warning printed | yes | `pending` (retry) |
| No `result.json`, session ran long enough | incomplete, "no result.json written" | yes | `pending` (retry) |
| No `result.json`, session died fast | infrastructure failure | **no** | `pending`, after a wait |
| Session killed by `pulseflow kill` | incomplete | yes, always | `pending` (retry) |

Notes:

- The verdict never comes from the exit code. A session that exits 0 having done nothing is
  `incomplete`.
- The raw claim is moved to `results/M02-attempt1.json`, so every attempt keeps its own record, and
  the drop box is cleared before the next session so a stale file is never graded twice.
- `blocked` stops the run even when the diagnosis is missing. Retrying a real block just burns the
  budget; the warning tells you the session broke protocol.
- Evidence from a later attempt replaces the previous evidence only when it is non-empty.
- A killed session is never refunded as infrastructure, whatever its transcript looks like.

## Infrastructure failures

The rule that came out of the very first overnight run, which burned three attempts in forty seconds
against a usage limit.

A session is classified as an infrastructure failure when **all** of these hold:

1. it was not killed by `pulseflow kill`, and
2. it wrote no `result.json`, and
3. it lasted less than `infra.deathSeconds` (90s), and
4. either the last 4 KB of transcript matches one of `infra.usageLimitPatterns`, or the transcript is
   smaller than `infra.tinyTranscriptBytes` (500 B).

Then the engine pushes an `infra-failure` entry into the milestone history, puts the milestone back to
`pending` **without incrementing attempts**, waits, and relaunches.

How long it waits:

- **Usage limit with an announced reset time**: until that time, plus 30 seconds. Claude Code prints
  something like `You've hit your session limit · resets 3:00pm`; the engine parses it, and if the
  time has already passed today it assumes tomorrow. A parsed wait longer than 12 hours is treated as
  unusable and falls back to the fixed wait.
- **Usage limit with no parseable time**: `infra.usageLimitWaitSeconds`, 10 minutes.
- **Instant death** (auth prompt, network, missing binary): `infra.genericWaitSeconds`, 60 seconds.

In the terminal:

```
   session ended (exit 1, 6s, 214 B transcript)
!! usage-limit: waiting 47m for the announced reset - waiting 47m, attempt NOT consumed (1/30)
```

After `infra.maxRetries` consecutive infrastructure failures (30 by default) the runner gives up with
exit 1. Any session that produces a real verdict resets that counter to zero.

If your provider words its limit differently, add the wording to `infra.usageLimitPatterns`.

## The pulse: is this run alive?

The pulse block in `pulseflow status` answers three separate questions.

**Is a runner process alive?** `pulse.json` holds the runner pid, the current milestone, the agent pid
and the last event. The file is deleted when the runner exits cleanly, so:

- no `pulse.json` means no run in progress; start one.
- `pulse.json` present and the pid alive means the runner is up; the last-event age tells you when it
  last did anything.
- `pulse.json` present and the pid dead means the runner died abruptly (closed terminal, reboot, OOM).
  Relaunch with `pulseflow run`; the milestone is picked up again.

**How long has this session been running?** Printed as `session`. Compare it against how long you
expected the milestone to take. Three hours on a 45-minute milestone is a hung session.

**Is anything actually being produced?** The liveness line, driven by your `liveness` paths:

| Newest signal age | Verdict shown |
| --- | --- |
| under 15 min | `alive` |
| 15 to 25 min | `slow but alive` |
| over 25 min | `possibly hung` |

Those same thresholds drive the supervisor's playbook, so it is worth tuning your `liveness` list
until the verdict matches reality for your project.

A poll loop while you work on something else:

```sh
while true; do clear; pulseflow status; sleep 300; done
```

## The supervisor

The engine keeps a run correct. The supervisor keeps it *alive*. It is a Claude session that wakes
every ten minutes, reads the whole run in one call, and applies the first matching rule of a bounded
playbook.

### Starting it

```sh
pulseflow skill install          # writes .claude/skills/pulseflow-supervisor/SKILL.md
```

Then, in a Claude Code session at the project root:

```
/loop 10m Use the pulseflow-supervisor skill to perform one supervision cycle.
```

One invocation is one cycle: gather, apply at most one rule, report. The loop is what makes it a
supervisor.

### What it may and may not do

Its entire write surface is four things: `pulseflow kill`, `pulseflow attend`, relaunching
`pulseflow run`, and appending to `.pulseflow/supervisor-log.md`.

It never edits project code, prompts, the protocol or `state.json`. It never runs the project's own
tools (build, tests, dev server, editor) because the executor session owns them and a parallel call
can corrupt the run. And it never calls `pulseflow unblock`: clearing a block is a human decision.

### The playbook, first match wins

| # | Situation | Action |
| --- | --- | --- |
| 1 | `runComplete: true` | Final report, close the log, stop the loop. |
| 2 | A liveness signal younger than 15 minutes, nothing blocked | Report only. Do not intervene. |
| 3 | A watched signal frozen past its normal cadence and no fresher one | `pulseflow attend`, then re-check next cycle. Cannot fire without an adapter. |
| 4 | An agent process exists but every signal is older than 25 minutes | `pulseflow kill --reason "..."`. Twice on the same milestone means escalate instead. |
| 5 | The last run-log entry is `infra:usage-limit` and the runner is alive | Do nothing. The engine is already waiting and not consuming attempts. |
| 6 | Work remains, nothing blocked, no runner process | Relaunch `pulseflow run`. Two failed relaunches in a row means escalate. |
| 7 | A milestone is `blocked` | Quote the diagnosis verbatim and stop. No auto-fix, no unblock. |
| 8 | Anything it cannot explain | Touch nothing, describe precisely, escalate. |

Two failed interventions on the same milestone always end the same way: stop and escalate. Repeating
an intervention that did not work is how an automated supervisor turns a stalled run into a wrecked
one.

### What a cycle reports

Compact, in the language you are speaking to it: current milestone and what it is doing, progress
since the last cycle (commits, evidence, attempts, milestones closed), a one-word verdict
(`advancing` / `slow but alive` / `intervened: rule <n>` / `blocked: ... -> ...` / `run complete`),
and any new decisions worth your attention. No code review, no plan for the run; those are post-run
conversations.

### Doing it without the skill

The supervisor is convenience, not a dependency. Everything it does is available to you:
`pulseflow status --json` to see the run, `pulseflow kill` for a hung session, `pulseflow attend` for a
wedged environment, `pulseflow run` to relaunch a dead runner.

## Environment adapters

Some environments get stuck in ways no agent can fix from inside its own session: a Unity editor
window loses focus and stops receiving input, a native modal blocks the main thread, a tool server
wedges. The adapter is your fix for that, expressed as one command line:

```json
"environment": {
  "attendCommand": "powershell -ExecutionPolicy Bypass -File .pulseflow/adapters/unity-attend.ps1 -Seconds {{seconds}}",
  "attendSeconds": 120
}
```

`{{seconds}}` is substituted; the command runs from the project root with a timeout of
`seconds + 60`; its last ten output lines are printed and its last line is recorded in
`supervisor-log.md`. The Unity adapter used in the original overnight runs (window focus keeper plus
Win32 modal dismissal) is in `reference/unity-attend.ps1`, ready to copy into a project.

A headless project leaves `attendCommand` at `null`. Then `pulseflow attend` fails with an explanation
and playbook rule 3 simply cannot fire, which is the correct behaviour: there is nothing to unstick.

Write adapters that are idempotent and safe to run at any moment. The adapter can be invoked while a
session is mid-work, so it must not touch project files, kill the agent, or restart anything the
session is using.

## Use cases

### 1. Overnight feature run on a web app

Five milestones, one feature, one night. The classic case.

```sh
pulseflow init --run checkout-v2 --milestones 5
# write protocol.md and prompts/M01..M05.md, set the titles in state.json
```

```json
"liveness": ["src", "tests/results/latest.json"],
"maxAttempts": 3
```

```sh
pulseflow run 2>&1 | tee run-checkout-v2.txt
```

In the morning, `pulseflow status`. Three outcomes are possible and all three are useful.

- `5/5 done`: read `execution-log.md` and `decisions.md`, then review the five tags.
- `3/5 done, 1 blocked`: the diagnosis says what to fix. Then `pulseflow unblock M04 && pulseflow run`.
- `runner gone`: the machine slept or the terminal closed. `pulseflow run` resumes from where the state
  file says it was. Put a supervisor on the next run and that third case fixes itself.

### 2. Test hardening on a legacy backend

Work that is repetitive, verifiable by a number, and boring enough that a human will not do it. One
milestone per module, acceptance criterion "coverage for module X at or above 80% and the suite stays
green".

```json
"liveness": ["src", "tests", "coverage/coverage-summary.json"],
"maxAttempts": 4,
"retryDelaySeconds": 30
```

Why `maxAttempts: 4`: flaky legacy suites fail for real reasons and a second or third attempt often
lands. Each retry starts from a clean session but keeps the code the previous attempt committed, so
progress is cumulative even when a verdict is not.

### 3. A host-bound project: Unity, Unreal, a connected device

The case that made pulseflow exist. The editor must run on your machine with a real window, so
container-based loops are not an option.

```json
"liveness": ["Assets/Scripts", "Logs/editmode-latest.xml"],
"infra": { "deathSeconds": 120 },
"environment": {
  "attendCommand": "powershell -ExecutionPolicy Bypass -File .pulseflow/adapters/unity-attend.ps1 -Seconds {{seconds}}",
  "attendSeconds": 120
}
```

The protocol's session-start step becomes "verify the editor answers over MCP; if it does not, block
with `environment-unreachable`". `deathSeconds` goes up because these sessions spend their first
minute waiting on a slow tool server, and you do not want a slow start misread as an instant death.

Evidence is a test XML plus screenshots, and the acceptance criteria name both. Run the supervisor
here: rule 3 (attend) and rule 4 (kill a hung session) are exactly the failures a GUI-bound run hits
at 3am.

### 4. A batch of many similar milestones

Twenty pages to migrate, thirty endpoints to document, fifteen components to port. Write one careful
prompt, then copy it with the target changed.

```sh
pulseflow init --run port-to-v2 --milestones 15
for i in $(seq -w 2 15); do sed "s/M01/M$i/" .pulseflow/prompts/M01.md > .pulseflow/prompts/M$i.md; done
# then edit each one's target and criteria
```

Prove the recipe on one milestone before launching the batch:

```sh
pulseflow run --milestone M01 --once
pulseflow status
```

If M01 comes back `done` with evidence that convinces you, launch the rest with plain `pulseflow run`.
If it comes back `incomplete`, the prompt is wrong, not the agent, and you found that out for the
price of one session instead of fifteen.

### 5. Working under a usage limit

A long run on a limited plan will hit the ceiling mid-night. That is exactly the case the infra rules
handle: the session dies in seconds, the engine parses the announced reset time, sleeps until then,
and relaunches the **same attempt**. You lose wall-clock, not budget.

To make it smoother:

```json
"infra": {
  "usageLimitWaitSeconds": 1800,
  "maxRetries": 40,
  "usageLimitPatterns": ["session limit", "usage limit", "rate limit", "429", "quota"]
}
```

And use the cheaper model for mechanical milestones, the strong one for the hard ones:

```sh
pulseflow run --milestone M01 --model claude-sonnet-5 --once
pulseflow run --milestone M02 --model claude-opus-5 --once
```

If a supervisor is watching, rule 5 keeps it from "helping" during the wait, which would only burn
the next window.

### 6. Supervised, one milestone at a time

You do not have to leave. `--once` turns pulseflow into a disciplined single-shot runner: fresh
session, hand-written spec, evidence gate, archived claim, and you review between milestones.

```sh
pulseflow run --once && pulseflow status && git log --oneline -5
```

This is also the best way to learn what your prompts are worth before trusting them overnight.

### 7. A run you cannot watch, watched for you

The full setup, and the one the product was built for:

```sh
pulseflow skill install
pulseflow run           # terminal 1, or a detached shell
```

```
# terminal 2, a Claude Code session at the project root
/loop 10m Use the pulseflow-supervisor skill to perform one supervision cycle.
```

Overnight, a run like this survives a wedged editor (rule 3), a session that stopped producing
anything (rule 4), a usage limit (rule 5, by doing nothing), and a runner that died with the terminal
(rule 6). What it will not do is decide for you: a real block waits with a written diagnosis, and in
the morning `pulseflow status` plus `supervisor-log.md` tell you the whole story.

## Recipes

**Resume after anything.** `pulseflow run`. There is no separate resume command; the state file is the
resume point. A milestone left `in_progress` by an interrupt is simply attempted again.

**Redo a milestone that was graded `done` but is not.** With the runner stopped, edit `state.json`: set
its `status` to `"pending"`, `attempts` to `0`, and clear `evidence`. Then `pulseflow run --milestone M03`.

**Roll back to the last green milestone.** If your protocol tags, and the default template does:

```sh
git reset --hard checkout-v2/M02
# then set M03 back to pending in state.json
pulseflow run
```

**Give one milestone a bigger model.**

```sh
pulseflow run --milestone M04 --model claude-opus-5
```

**Give one milestone more attempts.**

```sh
pulseflow run --milestone M04 --max-attempts 6
```

**Restart a session that is clearly stuck**, without stopping the run:

```sh
pulseflow kill --reason "no test output for 40m, transcript still empty"
```

**Read the playbook before installing the skill.**

```sh
pulseflow skill install --print | less
```

**Swap the agent.** Only the config changes:

```json
"agent": {
  "command": "some-other-agent",
  "args": ["run", "--prompt", "{{kickoff}}", "--cwd", "{{projectRoot}}"],
  "modelArgs": ["--model", "{{model}}"],
  "model": null,
  "env": {}
}
```

Only Claude Code is tested in v0.2, but the engine never learns agent names.

**Read what a session actually claimed.** `.pulseflow/results/M03-attempt2.json` is the raw, ungraded
claim. Compare it against the graded outcome in `state.json` when a verdict surprises you.

**Watch a live session's output.** Transcripts are flushed only at exit for headless Claude Code, so
`tail -f` on the log is usually silent. Watch the liveness paths instead, or `pulseflow status`.

**Notify yourself when the run needs you.**

```sh
pulseflow run; code=$?
case $code in
  0) echo "run complete" ;;
  2) echo "blocked: $(pulseflow status --json | jq -r '.milestones[] | select(.status=="blocked") | .id')" ;;
  *) echo "runner error" ;;
esac
```

**Audit what the supervisor did.**

```sh
cat .pulseflow/supervisor-log.md
grep killed .pulseflow/run-log.md
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `no .pulseflow/config.json found here or in any parent directory` | You are outside the project. | `cd` into it, or run `pulseflow init`. |
| `failed to launch "claude": ...` | The agent CLI is not on `PATH` for this shell. | Check `claude --version` in the same terminal; fix `PATH`, or put an absolute path in `agent.command`. |
| Every session ends in seconds, `instant-death` repeats | The agent cannot start: not authenticated, waiting on a permission prompt, wrong flags. | Run the exact command by hand and read what it says. The default args include `--dangerously-skip-permissions`; without it a headless session waits for a prompt nobody answers. |
| `claimed "done" with no evidence - downgraded to incomplete` | The protocol is not being followed, or the criteria do not name their evidence. | Rewrite the criteria so each names its evidence file. The template contract is already explicit. |
| `result.json is for "M02", expected "M03"` | The session wrote a stale or wrong id. | Usually a session that started the wrong milestone. Tighten the prompt's Objective and out-of-scope list. |
| A milestone is blocked with no diagnosis | The session hit the wall and gave up without writing one. | Read the transcript in `.pulseflow/logs/`, fix the cause, then `unblock`. |
| `liveness: not configured` | `liveness` is `[]`. | Add the paths that change while work happens. Without it, status can see a process but not progress, and playbook rules 3 and 4 cannot fire. |
| `liveness: no watched path exists yet` | A watched path does not exist. | Fix the path, or accept it if the file is only created later in the run. |
| `possibly hung` with a very long session | The agent is stuck in a loop or waiting on something. | `pulseflow kill --reason "..."`. The runner consumes the attempt and relaunches with fresh context. |
| `runner gone (pid ... not running)` | The runner process died abruptly. | `pulseflow run` to resume. For overnight runs use `tmux`/`screen`, disable sleep, and let the supervisor's rule 6 handle it. |
| `no pulse.json - no run is in progress` from `kill` | No runner is running. | Nothing to kill. Start or relaunch the run. |
| `no environment adapter configured` from `attend` | `environment.attendCommand` is `null`. | Either configure an adapter, or accept that this project has nothing to unstick. |
| `too many infrastructure failures (31) - giving up` | 30 consecutive failed launches. | Something is systematically wrong: auth expired, network down, plan exhausted. Fix it, then rerun. |
| Windows: an argument containing `%VAR%` gets mangled | The agent CLI is a `.cmd` shim and `cmd.exe` expands `%VAR%`. | The runner warns about this. Avoid `%...%` in the args template. |

## FAQ

**Can I add milestones mid-run?** Yes. Append an entry to `state.json` and create its prompt file while
the runner is stopped. The runner reloads the state file every iteration, but editing it under a live
runner risks losing a write.

**Can two runs share a project directory?** Not in v0.2: the paths under `.pulseflow/` are fixed. Use
separate working copies.

**Does it need git?** No, but the default protocol assumes it and tags every green milestone. Without
git you lose your rollback points, and the supervisor loses one of its progress signals.

**Who writes the milestone prompts?** You. You can of course ask an agent to draft them in a normal
session and then review them. What pulseflow refuses to do is generate them silently as part of a run.

**Is the transcript the source of truth?** No. Transcripts are for post-mortems. `state.json`,
`results/`, `run-log.md` and `supervisor-log.md` are the record.

**Does the supervisor cost tokens?** Yes: one short Claude cycle every ten minutes, each reading a
JSON snapshot and a few log tails. Widen the loop interval if that matters, at the cost of noticing
a stall later.

**Can the supervisor fix my code?** No, deliberately. It cannot edit anything in the project. If a
milestone needs a decision, it stops and asks you.

**What if the agent edits `state.json` anyway?** The kickoff and the protocol both forbid it, and the
engine reloads and rewrites state around each verdict, so a session's edit is likely to be lost. Treat
it as a protocol violation and fix the prompt.

**Does `done` mean the code is good?** It means the acceptance criteria have written evidence. The
strength of that guarantee is the quality of your criteria. Review the tags.

## Limits of v0.2

- **No HTML run report** (v0.3). The record is `status`, `state.json` and the two logs.
- **No steering file** for redirecting a run mid-flight (v0.3).
- **No plugin packaging** (v0.4). The supervisor is a skill the CLI writes, not a marketplace plugin.
- **One agent tested.** The command is a config string, but only Claude Code has been exercised.
- **One run per project directory.**
- **The supervisor is a loop, not a daemon.** If the Claude session hosting it dies, supervision stops
  until you restart it. A daemon is a later question, and only if the loop proves insufficient.

The roadmap is in [../README.md](../README.md); the reasoning behind each design decision is in
[DECISIONS.md](DECISIONS.md).
