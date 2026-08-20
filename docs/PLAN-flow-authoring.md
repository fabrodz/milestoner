# Plan: settle the flow authoring question

Item 5 of [NEXT.md](NEXT.md), separated because it is a decision first and work only if the decision
goes a particular way. Building anything here before answering it would be answering it by default.

## The question

Should milestoner let you author milestone specs in a UI - a flow builder, a form, anything other than
writing markdown in your editor?

[BRIEF.md](../BRIEF.md) puts milestone prompts in their own layer and says they are always
hand-written, and that the engine never generates them silently. That is the stated difference from
task-generating loops like Ralph. So this is not a feature request that can be scheduled; it either
holds or it is superseded in writing.

## Why the friction exists

Not aesthetics. The evidence gate is only as strong as the acceptance criteria: a criterion that
names no evidence produces a session that claims `done` with a paraphrase of the task, and the
engine has nothing to grade it against. The guide's rule - "name the evidence inside the criterion"
- is what makes D-007 mean anything.

So the real question is narrower than "UI or no UI": **does anything about authoring today produce
weak acceptance criteria?** If it does not, a UI is solving a problem that is not there.

## What the evidence says right now

The only real run this engine has executed is `v04-plugin`, whose four milestone prompts were
hand-written. Across them: **23 acceptance criteria, 23 naming their evidence artifact.** Not one
vague criterion, and no milestone with two unrelated gates.

One run is a small sample and its author was the person who wrote the format. But it is the only
evidence there is, and it points one way: authoring is not currently the weak link. Grading is
working, and it is working on hand-written input.

## The options, and what each commits to

**A. No authoring surface.** Prompts stay files. The panel stays read-and-intervene.
Keeps the product's claim intact, costs nothing. The risk is that the friction turns out to be a
real adoption barrier for anyone who is not the author of the format, and nothing here would tell us.

**B. A structured prompt editor.** A form with the sections the protocol expects, that refuses to
save an acceptance criterion with no named evidence, writing the same markdown files. Nothing is
generated - the structure is enforced, the content is yours. This is compatible with the BRIEF: it
makes good prompts easier to write rather than inventing them. It is also real UI work, and every
hour of it currently rests on zero evidence of need.

**C. A flow builder.** Boxes, arrows, dependencies, generated specs. This is the option the BRIEF
rules out, it is direct competition with Ralph on their own ground, and it is the shape most likely
to produce criteria the gate then rejects.

## Recommendation

**Decide A now, rule out C in writing, and keep B open behind a cheap experiment.**

The experiment is not a UI. It is a linter:

> `milestoner lint` - check every milestone prompt before a run starts. Does each have acceptance
> criteria? Does each criterion name an evidence artifact? Is there an exit section? Does any single
> milestone carry two unrelated gates?

That captures most of what option B's form would enforce, works in any editor, costs a fraction of a
UI, and can gate a run before a single session is launched - which is worth more than catching it
afterwards. It also produces exactly the evidence that would settle B: if real prompts fail the
linter often, a structured editor has a case; if they pass the way `v04-plugin`'s did, B would have
solved nothing.

## The work, if this is accepted

Small enough to be one milestone, and it belongs after v0.5 rather than inside it.

### M0x - `milestoner lint`

**Objective.** A prompt that will not produce gradeable evidence fails before the run starts rather
than after a session has spent an attempt on it.

**Tasks.**
1. Rules, each with a reason a person can act on: no acceptance criteria; a criterion with no named
   evidence artifact; no exit section; a milestone in `state.json` with no prompt file; a prompt file
   no milestone references.
2. `milestoner lint [--json]`, exit 1 on any error, 0 with warnings.
3. Decide and record whether `run` lints first and refuses to launch, or only warns. Refusing is
   truer to the evidence gate; warning is kinder to someone mid-iteration. This is the one real
   decision in the milestone.
4. Tests over fixture prompts: a good one passes, each rule fires on a prompt built to break it.
5. Document it in the guide, in the section on writing milestone prompts, where the rule it enforces
   is already stated in prose.

**Acceptance criteria.**
- **AC1** - The four `v04-plugin` prompts pass with no errors. (evidence: command output)
- **AC2** - Each rule fires on a fixture built to break it. (evidence: test names, one per rule)
- **AC3** - The lint-before-run decision is recorded in `docs/DECISIONS.md`. (evidence: entry id)
- **AC4** - The guide documents the command where the rule is already stated. (evidence: section
  name)

## What to write down either way

Whatever is decided, it belongs in `docs/DECISIONS.md` as an entry that either reaffirms the
hand-written layer with the evidence above, or supersedes the BRIEF's claim explicitly. The one
outcome to avoid is this question staying open while a UI grows an authoring surface by accident,
one convenience at a time.
