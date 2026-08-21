import type { MilestoneStatus } from "./types.js";

export interface LintFinding {
  /** null for run-level findings (protocol, config). */
  milestone: string | null;
  rule: string;
  severity: "error" | "warning";
  message: string;
  /** Path relative to the project root the finding points at. */
  file: string;
  line?: number;
}

export interface LintMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  /** Prompt file name from state, e.g. "M01.md". */
  prompt: string;
  /** The prompt file's text, or null when it is not on disk. */
  text: string | null;
}

export interface LintInput {
  run: string;
  milestones: LintMilestone[];
  /** Prompt file names present in .milestoner/prompts/. */
  promptFiles: string[];
  /** protocol.md text, or null when it is not on disk. */
  protocol: string | null;
  /** Number of configured liveness paths. */
  livenessCount: number;
}

export function protocolRunName(protocol: string): string | null {
  return protocol.match(/^# Execution protocol - run "(.+)"/m)?.[1] ?? null;
}

const PROMPTS_DIR = ".milestoner/prompts";
const STATE_FILE = ".milestoner/state.json";
const PROTOCOL_FILE = ".milestoner/protocol.md";
const CONFIG_FILE = ".milestoner/config.json";

/** Instructional lines the scaffold writes; any of them surviving means the prompt was not filled in. */
const TEMPLATE_LINES = [
  "Milestone prompts are hand-written. The engine never generates the actual work specification.",
  "One paragraph: what exists at the end of this milestone that does not exist now, and why it matters",
  "- Files and modules this touches.",
  "- Decisions already made elsewhere that constrain this milestone.",
  "- What is explicitly out of scope.",
];
const PLACEHOLDER_ITEM = /^\s*(?:\d+\.|-)\s+\.\.\.\s*$/;
const PLACEHOLDER_CRITERION = /^-\s+\*\*AC\d+\*\*\s+-\s+\.\.\./;

interface BodyLine {
  text: string;
  line: number;
}

function findSection(lines: string[], name: string): { heading: number; body: BodyLine[] } | null {
  const headingRe = new RegExp(`^##\\s+${name}\\s*$`, "i");
  for (let i = 0; i < lines.length; i += 1) {
    if (!headingRe.test(lines[i] ?? "")) continue;
    const body: BodyLine[] = [];
    for (let j = i + 1; j < lines.length && !/^##?\s/.test(lines[j] ?? ""); j += 1) {
      body.push({ text: lines[j] ?? "", line: j + 1 });
    }
    return { heading: i + 1, body };
  }
  return null;
}

/** Bullets with their indented continuation lines folded in; a blank line ends a bullet. */
function bulletsOf(body: BodyLine[]): BodyLine[] {
  const out: BodyLine[] = [];
  let current: BodyLine | null = null;
  for (const l of body) {
    if (/^[-*]\s+/.test(l.text)) {
      if (current) out.push(current);
      current = { text: l.text, line: l.line };
    } else if (current && /^\s+\S/.test(l.text)) {
      current.text += ` ${l.text.trim()}`;
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

function namesAnArtifact(bullet: string): boolean {
  const note = bullet.match(/\(evidence:\s*([^)]*)\)/i);
  if (!note) return false;
  return (note[1] ?? "").replace(/[.\s]/g, "").length > 0;
}

export function lintRun(input: LintInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const error = (milestone: string, rule: string, message: string, file: string, line?: number) =>
    findings.push({ milestone, rule, severity: "error", message, file, ...(line === undefined ? {} : { line }) });

  for (const m of input.milestones) {
    const promptPath = `${PROMPTS_DIR}/${m.prompt}`;

    if (m.title.startsWith("TODO:")) {
      error(m.id, "template-residue", `title in state is still the scaffold placeholder "${m.title}"`, STATE_FILE);
    }

    if (m.text === null) {
      error(m.id, "missing-prompt", `prompt file ${promptPath} is not on disk`, promptPath);
      continue;
    }

    const lines = m.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const residue =
        TEMPLATE_LINES.includes(line.trim()) || PLACEHOLDER_ITEM.test(line) || PLACEHOLDER_CRITERION.test(line);
      if (residue) {
        error(m.id, "template-residue", `scaffold placeholder still present: "${line.trim()}"`, promptPath, i + 1);
      }
    }

    const objective = findSection(lines, "Objective");
    if (!objective) {
      error(m.id, "objective-missing", "no ## Objective section", promptPath);
    } else if (!objective.body.some((l) => l.text.trim() !== "")) {
      error(m.id, "objective-missing", "the ## Objective section is empty", promptPath, objective.heading);
    }

    const criteria = findSection(lines, "Acceptance criteria");
    const criterionBullets = criteria ? bulletsOf(criteria.body) : [];
    if (!criteria) {
      error(m.id, "criteria-missing", "no ## Acceptance criteria section", promptPath);
    } else if (criterionBullets.length === 0) {
      error(m.id, "criteria-missing", "the ## Acceptance criteria section has no criterion bullets", promptPath, criteria.heading);
    }
    for (const bullet of criterionBullets) {
      if (!namesAnArtifact(bullet.text)) {
        error(m.id, "evidence-missing", "criterion has no (evidence: ...) note naming an artifact", promptPath, bullet.line);
      }
    }

    const tag = `${input.run}-${m.id}`;
    const exit = findSection(lines, "Exit");
    if (!exit) {
      error(m.id, "exit-missing", "no ## Exit section", promptPath);
    } else if (!exit.body.some((l) => l.text.includes(tag))) {
      error(m.id, "exit-missing", `the ## Exit section does not mention the tag ${tag}`, promptPath, exit.heading);
    }
  }

  const warn = (rule: string, message: string, file: string) =>
    findings.push({ milestone: null, rule, severity: "warning", message, file });

  const referenced = new Set(input.milestones.map((m) => m.prompt));
  for (const name of input.promptFiles) {
    if (!referenced.has(name)) {
      warn("orphan-prompt", `${PROMPTS_DIR}/${name} is referenced by no milestone in state`, `${PROMPTS_DIR}/${name}`);
    }
  }

  if (input.protocol === null) {
    warn("protocol-run-mismatch", `${PROTOCOL_FILE} is not on disk, so no run is named`, PROTOCOL_FILE);
  } else {
    const named = protocolRunName(input.protocol);
    if (named === null) {
      warn("protocol-run-mismatch", "the protocol header names no run", PROTOCOL_FILE);
    } else if (named !== input.run) {
      warn("protocol-run-mismatch", `the protocol header names run "${named}", not "${input.run}"`, PROTOCOL_FILE);
    }
  }

  if (input.livenessCount === 0) {
    warn("liveness-empty", "no liveness paths configured, so nothing proves a session is doing anything", CONFIG_FILE);
  }

  return findings;
}
