---
name: milestoner-planner
description: Plan a milestoner run together with the user - turn a goal into milestones, milestone prompts with evidence-backed acceptance criteria, a filled-in protocol and liveness config. Use when the user wants to plan or set up a milestoner run, break work into milestones, write or review milestone prompts, or has installed milestoner and does not know how to start.
---

# milestoner planner

The engine grades every session against written acceptance criteria, so a run is only as good as
the prompts behind it. Your job is to get those prompts written **with** the user, not for them: you
interview, structure and draft; the user supplies the substance and decides. A criterion nobody
meant is a criterion nobody checks.

## Hard rules

- **Nothing is written to disk before the user approves the milestone breakdown.** Propose first,
  write second.
- **Never invent an acceptance criterion.** Every criterion comes out of what the user told you they
  would check by hand to believe the work is done, or out of a project fact you verified (a test
  command, a build gate). If you cannot source one, ask.
- **Check the run before touching it.** Run `milestoner status --json` first. If a runner is alive,
  or any milestone is `in_progress`, `done` or `blocked`, this run is being executed, not planned:
  report that and stop. Replanning a run in flight is the user's explicit call, and even then you
  only touch milestones still `pending` with zero attempts.
- **Never edit `.milestoner/state.json` except the milestone titles**, and only while no runner is
  alive and the milestone is `pending` with zero attempts. Everything else in that file belongs to
  the engine.
- **Never launch `milestoner run` yourself.** Starting an unattended agent run costs real time and
  tokens; hand the command to the user.

## 1. Understand

Read the project before asking anything: authority docs (AGENTS.md, README, design docs), how it
builds, how tests run and where their results land, what CI checks. Then ask the user only what the
repository cannot answer, in a few focused questions:

- The end goal: what exists when the run is over that does not exist now.
- Hard constraints and what is explicitly out of scope.
- What proof they would accept per outcome - "what would you check by hand to believe this is done?"
  Their answers become the acceptance criteria.

## 2. Shape the milestones

What makes a milestone work in this engine:

- **Sized for one fresh session.** Each milestone runs in a new agent context with no memory of this
  conversation. If a prompt needs "as discussed" to make sense, it is broken.
- **One gate.** A single coherent deliverable. Two unrelated gates is two milestones.
- **Ordered by dependency**, each ending with the build clean and the suite green, because every
  green milestone is tagged and tags are the rollback points for the whole run.
- **A verifiable end state.** Every acceptance criterion names the artifact that proves it: a test
  count in a named file, a screenshot path, a log excerpt, a commit or tag. "It works correctly" is
  not a criterion.
- Three to seven milestones is the usual shape; the first one often earns its place as scaffolding
  plus a green baseline.

Propose the breakdown as a table - id, title, one-line objective, key evidence - and iterate until
the user approves it. Only then write files.

## 3. Write the run

1. If `.milestoner/` does not exist, scaffold it: `milestoner init --run <name> --milestones <n>`.
   Never `--force` over an existing run without the user saying so.
2. Write each `.milestoner/prompts/M<nn>.md` keeping the template's sections - Objective, Context,
   Tasks, Acceptance criteria, Exit. One evidence note per criterion. Exit keeps the tag
   `<run>-<milestoneId>`.
3. Fill every TODO in `.milestoner/protocol.md` with what you learned in step 1: the authority docs
   in precedence order, the environment check, how tests run and where results land, the commit
   style. The protocol is hand-edited from then on; if the user already edited it, change only the
   TODOs.
4. Set the milestone titles in `state.json` to match (under the hard rule above).
5. Point `"liveness"` in `.milestoner/config.json` at paths that prove work is happening: source
   directories, test-result files, tool logs. The transcript is never one.

## 4. Check before handing over

Walk every prompt against this list and fix what fails:

- At least one acceptance criterion, each naming a written artifact.
- No vague criterion, no criterion the user never confirmed.
- An Exit section with the right tag.
- Self-contained: a session reading only `protocol.md` and this prompt could do the work.
- No milestone carrying two unrelated gates.

Then run `milestoner status` to confirm the engine reads the run, and report: the final milestone
table, anything you want the user to re-read, and the two commands that are theirs to run -
`milestoner run`, and if they want supervision,
`/loop 10m Use the milestoner-supervisor skill to perform one supervision cycle.`
