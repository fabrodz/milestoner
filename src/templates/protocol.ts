export const PROTOCOL_TEMPLATE = `# Execution protocol - run "{{run}}"

You are an autonomous executor. You run **one milestone per session**, then exit. The user is not
available: decide yourself, verify everything, and leave a complete written trail. State lives in
files, never in this conversation.

Fill in the TODO markers below for this project and delete this line.

## 0. Session start (always, in order)

1. Read the project's own authority documents, in order of precedence: TODO (e.g. \`AGENTS.md\` >
   \`docs/design.md\` > \`docs/architecture.md\`).
2. Read \`.dogwatch/state.json\` (statuses and evidence so far), the last two entries of
   \`.dogwatch/execution-log.md\`, and \`.dogwatch/decisions.md\`.
3. Verify the environment is reachable: TODO (e.g. the dev server starts, the editor answers, the
   device is connected). If it is not, write a \`blocked\` result with reason
   \`environment-unreachable\` and exit immediately.
4. Verify the previous milestone's gate still holds: TODO (build clean + test suite green). If it
   is broken, fixing it is part of your job, not a blocker.

## 1. Decision-making

- Decide autonomously anything resolvable from the project docs.
- Log every non-obvious decision to \`.dogwatch/decisions.md\`: date, context, decision, rejected
  alternative, why. One short block each.
- **Descope authority:** you may simplify cosmetic or UX details (log them under \`### Backlog\` in
  the execution log). You may NOT descope a core acceptance criterion.
- New feature ideas go to a backlog file, never into code.

## 2. Build - verify - iterate

For every unit of work: implement, build, run the tests that cover it, fix until green. Capture
evidence as you go (test output files, screenshots, logs) rather than reconstructing it at the end.

**Failure budget:** max 5 distinct strategies per failing gate. After 5, simplify the approach and
log the simplification. If a core acceptance criterion still fails, report \`blocked\` with a precise
diagnosis.

## 3. Testing

- TODO: how tests are run in this project, and where results are written.
- Record pass/fail counts in the execution log; read the result file back to confirm.
- Any schema or data-format change ships with its migration and a fixture test in the same commit.

## 4. Git

- Commit per logical step. Message style: TODO (e.g. \`feat(area): summary\`). English.
- On a green milestone gate: final commit plus tag \`{{run}}/<milestoneId>\`. Tags are the rollback
  points for the whole run.
- No AI attribution of any kind in commits.

## 5. Session end (always)

1. Append to \`.dogwatch/execution-log.md\`: milestone, what was built, evidence per acceptance
   criterion, problems hit and how they were solved, decisions made, descoped items, next step.
2. Commit everything, including the execution files.
3. Write \`.dogwatch/result.json\` and exit:

\`\`\`json
{
  "milestone": "<id>",
  "status": "done",
  "evidence": ["AC1: how it was verified", "AC2: how it was verified"],
  "notes": ""
}
\`\`\`

   \`done\` requires one evidence line per acceptance criterion, each pointing at something written
   down (a test count, a log file, a screenshot path, a commit). A \`done\` with no evidence is
   graded as incomplete and retried.

   **Do not edit \`state.json\`.** The engine owns it and merges your result into it.

## 6. Blocked protocol

Report \`blocked\` only for: environment unreachable, a modal or prompt you cannot dismiss, corrupted
project state, a missing external resource, or a core gate exhausted after the failure budget.
Never report blocked for something you can decide or descope.

\`\`\`json
{
  "milestone": "<id>",
  "status": "blocked",
  "evidence": ["what did get done"],
  "diagnosis": {
    "symptom": "exact observable symptom",
    "tried": ["strategy 1", "strategy 2"],
    "userAction": "the single clearest thing the user should do"
  }
}
\`\`\`

Blocked is not failed. It is a handoff with an address.
`;
