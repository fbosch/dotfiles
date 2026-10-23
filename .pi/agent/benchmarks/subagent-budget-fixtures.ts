import type { BudgetProgress } from "../extensions/subagents/budget";

export type FixtureLabel =
  | "productive"
  | "stalled"
  | "insufficient-evidence"
  | "approval-blocked"
  | "input-blocked"
  | "unscorable";

export interface PilotFixture {
  readonly id: string;
  readonly intendedLabel: FixtureLabel;
  readonly prompt: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface CheckedDeliverable {
  readonly verifiedFacts: readonly string[];
  readonly invalidClaims: number;
  readonly complete: boolean;
  readonly blocker: "approval" | "input" | null;
}

interface FactOracle {
  readonly id: string;
  readonly value: string;
  readonly citation: string;
}

interface FixtureOracle {
  readonly facts: readonly FactOracle[];
  readonly blocker: "approval" | "input" | null;
  readonly blockerFact: string | null;
}

interface PilotReport {
  readonly fixtureId: string;
  readonly facts: readonly {
    readonly id: string;
    readonly value: string;
    readonly citation: string;
  }[];
  readonly blocker: "approval" | "input" | null;
}

const REPORT_MARKER = "PILOT_RESULT";
const MAX_VISIBLE_TEXTS = 32;
const MAX_VISIBLE_TEXT_LENGTH = 8_192;
const MAX_TOTAL_VISIBLE_LENGTH = 32_768;
const MAX_REPORT_LENGTH = 4_096;
const MAX_FACTS_PER_REPORT = 12;
const MAX_FIELD_LENGTH = 180;

const promptTail =
  "Return one visible line beginning `PILOT_RESULT ` followed by JSON with exactly these keys: " +
  "`fixtureId`, `facts`, and `blocker`. Each fact has exactly `id`, `value`, and `citation`; " +
  "cite a supplied fixture file as `path:line`. Every fact field must be a string. " +
  "Copy the relevant source expression exactly, use string literal contents without quotes, " +
  "encode boolean/undefined literals as strings, and join array elements with `|`. " +
  'Set blocker to null when unblocked, otherwise "approval" or "input". ' +
  "Do not claim facts you cannot cite. Do not edit files.";

const fixtureDefinitions = [
  {
    id: "runner-trace",
    intendedLabel: "productive",
    prompt:
      "Workload: Subagent-runner maintenance (Recommended). Inspect the pinned read-only " +
      "runner trace fixture. Report the near-boundary condition (fact id `checkpoint-window`) " +
      "and the required completed-tool condition (fact id `completed-tool-gate`). " +
      promptTail,
    files: {
      "src/budget-gate.ts": [
        "export const WRAP_UP_TURNS = 2;",
        "export function shouldAssess(remaining: number, completedTools: number): boolean {",
        "  return remaining <= WRAP_UP_TURNS && completedTools > 0;",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "runner-lag",
    intendedLabel: "stalled",
    prompt:
      "Workload: Subagent-runner maintenance (Recommended). In the pinned read-only " +
      "revision fixture, explain when advice can be reused and what makes it stale " +
      "(fact ids `reuse-same-revision` and `increment-invalidates`). Report only " +
      "facts supported by the supplied source. " +
      promptTail,
    files: {
      "src/revision-ledger.ts": [
        "export function adviceCanBeReused(currentRevision: number, checkedRevision: number): boolean {",
        "  return currentRevision === checkedRevision;",
        "}",
        "export function adviceIsStale(currentRevision: number, checkedRevision: number): boolean {",
        "  return currentRevision !== checkedRevision;",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "unknown-envelope",
    intendedLabel: "insufficient-evidence",
    prompt:
      "Workload: Subagent-runner maintenance (Recommended). Inspect the pinned read-only " +
      "legacy wrapper fixture and report its status and detail (fact ids `legacy-status` " +
      "and `legacy-detail`). Do not infer task completion from a wrapper claim. " +
      promptTail,
    files: {
      "src/legacy-wrapper.ts": [
        'export const status = "complete";',
        'export const detail = "check passed";',
      ].join("\n"),
    },
  },
  {
    id: "approval-gate",
    intendedLabel: "approval-blocked",
    prompt:
      "Workload: Subagent-runner maintenance (Recommended). Inspect the pinned read-only " +
      "approval fixture. Report whether approval is required and mutation is allowed " +
      "(fact ids `approval-required` and `mutation-blocked`); set `blocker` to " +
      '`"approval"`. Do not attempt a change. ' +
      promptTail,
    files: {
      "src/task-state.ts": [
        "export const approvalRequired = true;",
        "export const mutationAllowed = false;",
      ].join("\n"),
    },
  },
  {
    id: "parent-choice",
    intendedLabel: "input-blocked",
    prompt:
      "Workload: Subagent-runner maintenance (Recommended). Inspect the pinned read-only " +
      "parent-choice fixture. Report the permitted choices and whether one is selected " +
      '(fact ids `choice-set` and `choice-unselected`); set `blocker` to `"input"`. ' +
      "Ask the parent to choose; do not infer a choice or make changes. " +
      promptTail,
    files: {
      "src/task-input.ts": [
        'export const permittedChoices = ["keep", "lower"] as const;',
        "export const selectedChoice: string | undefined = undefined;",
      ].join("\n"),
    },
  },
] as const satisfies readonly PilotFixture[];

export const PILOT_FIXTURES: readonly PilotFixture[] = Object.freeze(
  fixtureDefinitions.map((fixture) =>
    Object.freeze({
      ...fixture,
      files: Object.freeze({ ...fixture.files }),
    }),
  ),
);

const fixtureOracles: Readonly<Record<string, FixtureOracle>> = Object.freeze({
  "runner-trace": {
    facts: [
      {
        id: "checkpoint-window",
        value: "remaining <= WRAP_UP_TURNS",
        citation: "src/budget-gate.ts:3",
      },
      {
        id: "completed-tool-gate",
        value: "completedTools > 0",
        citation: "src/budget-gate.ts:3",
      },
    ],
    blocker: null,
    blockerFact: null,
  },
  "runner-lag": {
    facts: [
      {
        id: "reuse-same-revision",
        value: "currentRevision === checkedRevision",
        citation: "src/revision-ledger.ts:2",
      },
      {
        id: "increment-invalidates",
        value: "currentRevision !== checkedRevision",
        citation: "src/revision-ledger.ts:5",
      },
    ],
    blocker: null,
    blockerFact: null,
  },
  "unknown-envelope": {
    facts: [
      {
        id: "legacy-status",
        value: "complete",
        citation: "src/legacy-wrapper.ts:1",
      },
      {
        id: "legacy-detail",
        value: "check passed",
        citation: "src/legacy-wrapper.ts:2",
      },
    ],
    blocker: null,
    blockerFact: null,
  },
  "approval-gate": {
    facts: [
      {
        id: "approval-required",
        value: "true",
        citation: "src/task-state.ts:1",
      },
      {
        id: "mutation-blocked",
        value: "false",
        citation: "src/task-state.ts:2",
      },
    ],
    blocker: "approval",
    blockerFact: "approval-required",
  },
  "parent-choice": {
    facts: [
      {
        id: "choice-set",
        value: "keep|lower",
        citation: "src/task-input.ts:1",
      },
      {
        id: "choice-unselected",
        value: "undefined",
        citation: "src/task-input.ts:2",
      },
    ],
    blocker: "input",
    blockerFact: "choice-unselected",
  },
});

const EMPTY_RESULT: CheckedDeliverable = Object.freeze({
  verifiedFacts: Object.freeze([]),
  invalidClaims: 0,
  complete: false,
  blocker: null,
});

function invalidResult(invalidClaims = 1): CheckedDeliverable {
  return Object.freeze({
    verifiedFacts: Object.freeze([]),
    invalidClaims,
    complete: false,
    blocker: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildPilotPrompt(fixture: PilotFixture): string {
  return `${fixture.prompt}\nUse fixtureId: ${JSON.stringify(fixture.id)}.\nSupplied files: ${Object.keys(fixture.files).join(", ")}`;
}

/** Extract visible SDK text without decoding full history snapshots or retaining reasoning blocks. */
export function visibleAssistantTexts(messages: readonly unknown[]): readonly string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    const visible = message.content
      .flatMap((block: unknown) =>
        isRecord(block) && block.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [],
      )
      .join("\n");
    if (visible) texts.push(visible);
  }
  return Object.freeze(texts);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasDuplicateJsonKeys(source: string): boolean {
  // JSON.parse validates syntax first; this only tracks object keys.
  const stack: ({ keys: Set<string>; expectsKey: boolean } | null)[] = [];
  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
    const token = match[0];
    const frame = stack.at(-1);
    if (token === "{") {
      stack.push({ keys: new Set(), expectsKey: true });
    } else if (token === "[") {
      stack.push(null);
    } else if (token === "}" || token === "]") {
      stack.pop();
    } else if (token === ",") {
      if (frame) frame.expectsKey = true;
    } else if (frame?.expectsKey && token.startsWith('"')) {
      const key: unknown = JSON.parse(token);
      if (typeof key !== "string" || frame.keys.has(key)) return true;
      frame.keys.add(key);
      frame.expectsKey = false;
    }
  }
  return false;
}

function parseReport(visibleTexts: readonly string[]): {
  readonly report?: PilotReport;
  readonly invalid: boolean;
} {
  if (
    visibleTexts.length > MAX_VISIBLE_TEXTS ||
    visibleTexts.some((text) => text.length > MAX_VISIBLE_TEXT_LENGTH) ||
    visibleTexts.reduce((sum, text) => sum + text.length, 0) > MAX_TOTAL_VISIBLE_LENGTH
  ) {
    return { invalid: true };
  }

  const markerLines: string[] = [];
  let malformedMarker = false;
  for (const text of visibleTexts) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(REPORT_MARKER)) continue;
      if (!line.startsWith(`${REPORT_MARKER} `)) malformedMarker = true;
      else markerLines.push(line);
    }
  }

  if (malformedMarker || markerLines.length !== 1) {
    return { invalid: markerLines.length > 0 || malformedMarker };
  }

  const line = markerLines[0];
  if (line === undefined || line.length > MAX_REPORT_LENGTH) return { invalid: true };

  const json = line.slice(REPORT_MARKER.length + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { invalid: true };
  }

  if (hasDuplicateJsonKeys(json) || !isRecord(parsed)) return { invalid: true };
  if (!hasExactlyKeys(parsed, ["fixtureId", "facts", "blocker"])) return { invalid: true };
  if (typeof parsed.fixtureId !== "string" || parsed.fixtureId.length > 64)
    return { invalid: true };
  if (!Array.isArray(parsed.facts) || parsed.facts.length > MAX_FACTS_PER_REPORT) {
    return { invalid: true };
  }
  if (parsed.blocker !== null && parsed.blocker !== "approval" && parsed.blocker !== "input") {
    return { invalid: true };
  }

  for (const fact of parsed.facts) {
    if (
      !isRecord(fact) ||
      !hasExactlyKeys(fact, ["id", "value", "citation"]) ||
      typeof fact.id !== "string" ||
      fact.id.length > 64 ||
      typeof fact.value !== "string" ||
      fact.value.length > MAX_FIELD_LENGTH ||
      typeof fact.citation !== "string" ||
      fact.citation.length > MAX_FIELD_LENGTH
    ) {
      return { invalid: true };
    }
  }

  return { report: parsed as unknown as PilotReport, invalid: false };
}

export function checkDeliverable(
  fixture: PilotFixture,
  visibleTexts: readonly string[],
): CheckedDeliverable {
  const oracle = fixtureOracles[fixture.id];
  if (!oracle) return EMPTY_RESULT;

  const parsed = parseReport(visibleTexts);
  if (!parsed.report) return parsed.invalid ? invalidResult() : EMPTY_RESULT;

  const report = parsed.report;
  if (report.fixtureId !== fixture.id) return invalidResult();

  const verifiedFacts: string[] = [];
  const seen = new Set<string>();
  let invalidClaims = 0;
  for (const fact of report.facts) {
    if (seen.has(fact.id)) {
      invalidClaims++;
      continue;
    }
    seen.add(fact.id);
    const expected = oracle.facts.find((candidate) => candidate.id === fact.id);
    if (!expected || expected.value !== fact.value || expected.citation !== fact.citation) {
      invalidClaims++;
      continue;
    }
    verifiedFacts.push(expected.id);
  }

  let blocker: CheckedDeliverable["blocker"] = null;
  if (oracle.blocker !== null) {
    if (
      report.blocker === oracle.blocker &&
      oracle.blockerFact !== null &&
      verifiedFacts.includes(oracle.blockerFact)
    ) {
      blocker = oracle.blocker;
    } else if (report.blocker !== null) {
      invalidClaims++;
    }
  } else if (report.blocker !== null) {
    invalidClaims++;
  }

  const complete =
    oracle.blocker === null &&
    invalidClaims === 0 &&
    oracle.facts.every((expected) => verifiedFacts.includes(expected.id));

  return Object.freeze({
    verifiedFacts: Object.freeze(verifiedFacts),
    invalidClaims,
    complete,
    blocker,
  });
}

export function labelReference(
  fixture: PilotFixture,
  checkpoint: CheckedDeliverable | undefined,
  outcome: CheckedDeliverable,
  progress: BudgetProgress | undefined,
  waitingForParent: boolean,
): FixtureLabel {
  const oracle = fixtureOracles[fixture.id];
  if (!oracle || checkpoint === undefined || checkpoint.complete) return "unscorable";

  if (waitingForParent) {
    if (outcome.blocker === "approval" && oracle.blocker === "approval") {
      return "approval-blocked";
    }
    if (outcome.blocker === "input" && oracle.blocker === "input") {
      return "input-blocked";
    }
    return "unscorable";
  }
  if (outcome.blocker !== null) return "unscorable";
  if (progress === undefined || progress.completedTools === 0) return "insufficient-evidence";

  const unknownOnly =
    progress.unknownOutcomes > 0 &&
    progress.unknownOutcomes === progress.completedTools &&
    progress.verifiedSuccesses === 0 &&
    progress.failures === 0;
  if (unknownOnly) return "insufficient-evidence";

  const checkpointFacts = new Set(checkpoint.verifiedFacts);
  if (outcome.verifiedFacts.some((fact) => !checkpointFacts.has(fact))) {
    return "productive";
  }

  if (progress.verifiedSuccesses === 0 && progress.failures === 0) {
    return "insufficient-evidence";
  }
  return "stalled";
}
