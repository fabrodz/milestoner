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
