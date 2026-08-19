export const MILESTONE_TEMPLATE = `# {{id}} - {{title}}

Milestone prompts are hand-written. The engine never generates the actual work specification.

## Objective

One paragraph: what exists at the end of this milestone that does not exist now, and why it matters
for the run.

## Context

- Files and modules this touches.
- Decisions already made elsewhere that constrain this milestone.
- What is explicitly out of scope.

## Tasks

1. ...
2. ...
3. ...

## Acceptance criteria

Each one must be verifiable by something written down; you will report one evidence line per
criterion in \`.runpulse/result.json\`.

- **AC1** - ... (evidence: test count in \`<file>\`)
- **AC2** - ... (evidence: screenshot in \`<dir>\`)
- **AC3** - ... (evidence: log excerpt / commit hash)

## Exit

- All acceptance criteria evidenced.
- Build clean, test suite green.
- Committed and tagged \`{{run}}/{{id}}\`.
- \`.runpulse/result.json\` written with \`status: "done"\` and the evidence lines.
`;
