export type FactRole = "system" | "user" | "assistant" | "tool";
export type FactAuthority = "system" | "user" | "assistant" | "tool";
export type FactRelation = "equivalent" | "replaces" | "supports" | "conflicts" | "unknown";
export type FactJudgePhase = "relations" | "safety";

export interface FactSourceInput {
  readonly id: string;
  readonly order: number;
  readonly role: FactRole;
  readonly text: string;
  readonly authority?: FactAuthority;
  readonly scope?: string;
  readonly dependencies?: readonly string[];
}

export interface FactInput {
  readonly messages: readonly FactSourceInput[];
  readonly tailEvidence: readonly FactSourceInput[];
  readonly firstKeptEntryId: string;
  readonly piTokenBudget: number;
}

export interface FactQuestion {
  readonly instructions: string;
}

export interface FactJudgeRequest {
  readonly phase: FactJudgePhase;
  readonly questions: Readonly<Record<string, FactQuestion>>;
  readonly serializedBytes: number;
  readonly estimatedTokens: number;
}

export type FactJudge = (
  request: FactJudgeRequest,
  signal: AbortSignal,
  remainingMs: number,
) => Promise<unknown>;

export interface FactSelectionOptions {
  readonly signal?: AbortSignal;
}

export interface FactCoverageEntry {
  readonly unitId: string;
  readonly sourceId: string;
  readonly sourceOrder: number;
  readonly role: FactRole;
  readonly authority: FactAuthority;
  readonly origin: "message" | "tail";
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly disposition: "retained" | "exact-dedup" | "retired";
  readonly reason: string;
  readonly witnessId?: string;
  readonly relation?: FactRelation;
  readonly rendered: boolean;
}

export interface FactPairDecision {
  readonly pairId: string;
  readonly sourceFactId: string;
  readonly witnessFactId: string;
  readonly relation: FactRelation | "unreviewed";
  readonly safetyNoul?: number;
  readonly retired: boolean;
}

export interface FactSelectionSuccess {
  readonly kind: "success";
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly sourceChars: number;
  readonly wrappedChars: number;
  readonly estimatedTokens: number;
  readonly requests: number;
  readonly coverage: readonly FactCoverageEntry[];
  readonly pairs: readonly FactPairDecision[];
}

export type FactSelectionFailureReason =
  | "invalid-input"
  | "identity-collision"
  | "payload-limit"
  | "malformed-judge"
  | "judge-unavailable"
  | "timeout"
  | "caller-cancellation"
  | "irreducible"
  | "capacity";

export interface FactSelectionFailure {
  readonly kind: "refused" | "unavailable" | "cancelled";
  readonly reason: FactSelectionFailureReason;
  readonly requests: number;
}

export type FactSelectionResult = FactSelectionSuccess | FactSelectionFailure;

export const FACT_SELECTOR_LIMITS = {
  requestTimeoutMs: 2_400,
  maxConcurrentRequests: 4,
  maxQuestionsPerRequest: 16,
  maxRequestBytes: 32 * 1024,
  maxRequestEstimatedTokens: 10_000,
  maxEvidenceChars: 8_000,
  safetyThreshold: 0.99,
} as const;

type Origin = "message" | "tail";
type UnitKind = "fact" | "opaque" | "padding";

interface NormalizedSource extends FactSourceInput {
  readonly authority: FactAuthority;
  readonly scope: string;
  readonly dependencies: readonly string[];
  readonly origin: Origin;
  readonly sourceIndex: number;
}

interface EvidenceUnit {
  readonly id: string;
  readonly source: NormalizedSource;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: UnitKind;
  readonly approvalConstraint: boolean;
  readonly matchTerms: ReadonlySet<string>;
  readonly structuredKey?: string;
}

interface Pair {
  readonly id: string;
  readonly source: EvidenceUnit;
  readonly witness: EvidenceUnit;
}

interface RequestPlan {
  readonly request: FactJudgeRequest;
  readonly pairByQuestion: ReadonlyMap<string, Pair>;
}

interface PreparedInput {
  readonly sources: readonly NormalizedSource[];
  readonly units: readonly EvidenceUnit[];
  readonly sourceChars: number;
  readonly firstKeptEntryId: string;
  readonly piTokenBudget: number;
}

const AUTHORITY_RANK: Readonly<Record<FactAuthority, number>> = {
  tool: 0,
  assistant: 1,
  user: 2,
  system: 3,
};

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "here",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "not",
  "now",
  "of",
  "on",
  "or",
  "our",
  "should",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "will",
  "with",
  "would",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function roleAuthority(role: FactRole): FactAuthority {
  return role;
}

function isRole(value: unknown): value is FactRole {
  return value === "system" || value === "user" || value === "assistant" || value === "tool";
}

function isAuthority(value: unknown): value is FactAuthority {
  return isRole(value);
}

function safeScope(scope: string | undefined): string {
  return scope?.trim() || "conversation";
}

function sourceIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSources(
  input: FactInput,
):
  | { readonly kind: "ready"; readonly prepared: PreparedInput }
  | { readonly kind: "failure"; readonly reason: FactSelectionFailureReason } {
  if (
    !isRecord(input) ||
    !Array.isArray(input.messages) ||
    !Array.isArray(input.tailEvidence) ||
    !sourceIdentity(input.firstKeptEntryId) ||
    !Number.isSafeInteger(input.piTokenBudget) ||
    input.piTokenBudget < 0
  )
    return { kind: "failure", reason: "invalid-input" };

  const rawSources = [
    ...input.messages.map((source) => ({ source, origin: "message" as const })),
    ...input.tailEvidence.map((source) => ({ source, origin: "tail" as const })),
  ];
  const identities = new Set<string>();
  const sources: NormalizedSource[] = [];
  let sourceChars = 0;
  for (const [sourceIndex, entry] of rawSources.entries()) {
    const candidate = entry.source;
    if (
      !isRecord(candidate) ||
      !sourceIdentity(candidate.id) ||
      !Number.isSafeInteger(candidate.order) ||
      !isRole(candidate.role) ||
      typeof candidate.text !== "string" ||
      (candidate.authority !== undefined && !isAuthority(candidate.authority)) ||
      (candidate.scope !== undefined && typeof candidate.scope !== "string") ||
      (candidate.dependencies !== undefined &&
        (!Array.isArray(candidate.dependencies) ||
          candidate.dependencies.some((dependency) => typeof dependency !== "string")))
    )
      return { kind: "failure", reason: "invalid-input" };
    if (identities.has(candidate.id)) return { kind: "failure", reason: "identity-collision" };
    identities.add(candidate.id);

    const authority = candidate.authority ?? roleAuthority(candidate.role);
    const dependencies = [...new Set(candidate.dependencies ?? [])].sort();
    sources.push({
      id: candidate.id,
      order: candidate.order,
      role: candidate.role,
      text: candidate.text,
      authority,
      scope: safeScope(candidate.scope),
      dependencies,
      origin: entry.origin,
      sourceIndex,
    });
    if (entry.origin === "message") sourceChars += candidate.text.length;
  }

  const units: EvidenceUnit[] = [];
  const orderedSources = [...sources].sort(
    (left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex,
  );
  for (const source of orderedSources) {
    for (const segment of segmentSource(source.text)) {
      const text = source.text.slice(segment.start, segment.end);
      const kind = classifySegment(text, segment.code);
      units.push({
        id: `f${units.length + 1}`,
        source,
        start: segment.start,
        end: segment.end,
        text,
        kind,
        approvalConstraint: isApprovalConstraint(text, source.authority),
        matchTerms: extractMatchTerms(text),
        ...(structuredFieldKey(text) === undefined
          ? {}
          : { structuredKey: structuredFieldKey(text) }),
      });
    }
  }

  return {
    kind: "ready",
    prepared: {
      sources,
      units,
      sourceChars,
      firstKeptEntryId: input.firstKeptEntryId,
      piTokenBudget: input.piTokenBudget,
    },
  };
}

interface SourceSegment {
  readonly start: number;
  readonly end: number;
  readonly code: boolean;
}

function segmentSource(text: string): SourceSegment[] {
  const lines: SourceSegment[] = [];
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    lines.push({ start: lineStart, end: lineEnd, code: false });
    lineStart = lineEnd;
  }
  if (text.length === 0) return [];

  const segments: SourceSegment[] = [];
  let codeStart: number | undefined;
  let inFence = false;
  for (const line of lines) {
    const lineText = text.slice(line.start, line.end);
    const hasFence = lineText.includes("```");
    if (hasFence && !inFence) {
      codeStart = line.start;
      inFence = true;
    } else if (hasFence && inFence) {
      segments.push({ start: codeStart ?? line.start, end: line.end, code: true });
      codeStart = undefined;
      inFence = false;
      continue;
    }
    if (inFence) continue;
    for (const [start, end] of sentenceRanges(lineText, line.start))
      segments.push({ start, end, code: false });
  }
  if (inFence && codeStart !== undefined) {
    const last = lines.at(-1);
    segments.push({ start: codeStart, end: last?.end ?? text.length, code: true });
  }
  return segments;
}

function sentenceRanges(text: string, absoluteStart: number): readonly [number, number][] {
  if (text.trim().length === 0) return [[absoluteStart, absoluteStart + text.length]];
  if (preserveWholeLine(text)) return [[absoluteStart, absoluteStart + text.length]];

  const starts = [0];
  const boundary = /[.!?][ \t]+(?=[A-Z0-9"“‘])/gu;
  for (const match of text.matchAll(boundary)) {
    const index = match.index ?? 0;
    const punctuation = text[index];
    if (punctuation === ".") {
      const before = text.slice(0, index).trimEnd();
      const word = before.match(/(?:^|\s)([A-Za-z]{1,4})$/u)?.[1]?.toLowerCase();
      if (
        (word !== undefined && new Set(["dr", "e.g", "i.e", "mr", "mrs", "ms", "vs"]).has(word)) ||
        /\d$/u.test(before)
      )
        continue;
    }
    const end = index + match[0].length;
    if (end < text.length) starts.push(end);
  }
  return starts.map((start, index) => [
    absoluteStart + start,
    absoluteStart + (starts[index + 1] ?? text.length),
  ]);
}

function preserveWholeLine(text: string): boolean {
  return (
    text.includes("```") ||
    text.includes("`") ||
    /\b(?:if|unless|when|provided that|only if|according to|reported by|allegedly|without|except)\b/iu.test(
      text,
    ) ||
    /\b(?:maybe|perhaps|possibly|unclear|inconclusive|I think|it seems)\b/iu.test(text) ||
    /[{}\[\]<>]/u.test(text) ||
    /(?:^|\s)(?:const|let|var|function|class|import|export)\s/u.test(text) ||
    (text.match(/["']/gu)?.length ?? 0) % 2 !== 0 ||
    (text.match(/[(){}\[\]]/gu)?.length ?? 0) % 2 !== 0
  );
}

function classifySegment(text: string, code: boolean): UnitKind {
  if (text.trim().length === 0) return "padding";
  if (code || text.length > FACT_SELECTOR_LIMITS.maxEvidenceChars || preserveWholeLine(text))
    return "opaque";
  return "fact";
}

function isApprovalConstraint(text: string, authority: FactAuthority): boolean {
  return (
    authority === "user" &&
    /\b(?:approval|approved|permission|consent|authorization|authorisation)\b/iu.test(text) &&
    /\b(?:must|only|unless|until|without|before|requires?|required|do not|don't|never|not)\b/iu.test(
      text,
    )
  );
}

function structuredFieldKey(text: string): string | undefined {
  const match = text.trimStart().match(/^(?:[-*+]\s+)?([A-Za-z][A-Za-z0-9_.-]{1,40})\s*[:=]/u);
  return match?.[1]?.toLowerCase();
}

function extractMatchTerms(text: string): ReadonlySet<string> {
  const terms = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.:/-]*/gu) ?? [];
  return new Set(terms.filter((term) => term.length > 1 && !STOP_WORDS.has(term)).slice(0, 64));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function comparePosition(left: EvidenceUnit, right: EvidenceUnit): number {
  return (
    left.source.order - right.source.order ||
    left.source.sourceIndex - right.source.sourceIndex ||
    left.start - right.start
  );
}

function exactDeduplication(units: readonly EvidenceUnit[]): Map<string, string> {
  const canonicalByText = new Map<string, EvidenceUnit>();
  const duplicateOf = new Map<string, string>();
  for (const unit of units) {
    if (unit.kind !== "fact") continue;
    const key = JSON.stringify([
      unit.text,
      unit.source.authority,
      unit.source.scope,
      unit.source.dependencies,
      unit.source.origin,
    ]);
    const canonical = canonicalByText.get(key);
    if (canonical === undefined) canonicalByText.set(key, unit);
    else duplicateOf.set(unit.id, canonical.id);
  }
  return duplicateOf;
}

function canonicalId(unit: EvidenceUnit, duplicateOf: ReadonlyMap<string, string>): string {
  let id = unit.id;
  const visited = new Set<string>();
  while (duplicateOf.has(id)) {
    if (visited.has(id)) return unit.id;
    visited.add(id);
    id = duplicateOf.get(id) ?? id;
  }
  return id;
}

function pairScore(source: EvidenceUnit, witness: EvidenceUnit): number | undefined {
  if (
    source.kind !== "fact" ||
    witness.kind !== "fact" ||
    source.approvalConstraint ||
    source.source.scope !== witness.source.scope ||
    !sameStrings(source.source.dependencies, witness.source.dependencies) ||
    AUTHORITY_RANK[witness.source.authority] < AUTHORITY_RANK[source.source.authority] ||
    comparePosition(source, witness) >= 0
  )
    return undefined;

  if (source.structuredKey !== undefined && source.structuredKey === witness.structuredKey)
    return 1_000;

  const shared = [...source.matchTerms].filter((term) => witness.matchTerms.has(term)).length;
  const smaller = Math.min(source.matchTerms.size, witness.matchTerms.size);
  if (shared < 2 || smaller === 0 || shared / smaller < 0.5) return undefined;
  return shared / (source.matchTerms.size + witness.matchTerms.size - shared);
}

function proposePairs(
  units: readonly EvidenceUnit[],
  duplicateOf: ReadonlyMap<string, string>,
): Pair[] {
  const candidates = units
    .filter((unit) => unit.id === canonicalId(unit, duplicateOf) && unit.kind === "fact")
    .toSorted(comparePosition);
  const termPostings = new Map<string, EvidenceUnit[]>();
  const fieldPostings = new Map<string, EvidenceUnit[]>();
  const pairs: Pair[] = [];

  for (const witness of candidates) {
    const possible = new Map<string, EvidenceUnit>();
    const addRecent = (postings: readonly EvidenceUnit[] | undefined) => {
      for (const source of postings?.slice(-64) ?? []) possible.set(source.id, source);
    };
    for (const term of witness.matchTerms) addRecent(termPostings.get(term));
    if (witness.structuredKey !== undefined) addRecent(fieldPostings.get(witness.structuredKey));

    for (const source of [...possible.values()].toSorted(comparePosition)) {
      if (pairScore(source, witness) !== undefined)
        pairs.push({ id: `p${pairs.length + 1}`, source, witness });
    }

    for (const term of witness.matchTerms) {
      const postings = termPostings.get(term) ?? [];
      postings.push(witness);
      termPostings.set(term, postings);
    }
    if (witness.structuredKey !== undefined) {
      const postings = fieldPostings.get(witness.structuredKey) ?? [];
      postings.push(witness);
      fieldPostings.set(witness.structuredKey, postings);
    }
  }
  return pairs;
}

function quotedFact(unit: EvidenceUnit): string {
  return JSON.stringify(unit.text);
}

function relationInstructions(pair: Pair): string {
  return [
    `Classify the relation only; do not decide whether deletion is safe. PAIR_ID=${JSON.stringify(pair.id)}.`,
    `SOURCE_FACT_ID=${JSON.stringify(pair.source.id)} SOURCE=${JSON.stringify({
      sourceIdentity: pair.source.source.id,
      role: pair.source.source.role,
      authority: pair.source.source.authority,
      order: pair.source.source.order,
      scope: pair.source.source.scope,
      dependencies: pair.source.source.dependencies,
    })} TEXT=${quotedFact(pair.source)}`,
    `WITNESS_FACT_ID=${JSON.stringify(pair.witness.id)} WITNESS=${JSON.stringify({
      sourceIdentity: pair.witness.source.id,
      role: pair.witness.source.role,
      authority: pair.witness.source.authority,
      order: pair.witness.source.order,
      scope: pair.witness.source.scope,
      dependencies: pair.witness.source.dependencies,
    })} TEXT=${quotedFact(pair.witness)}`,
    "Choose equivalent, replaces, supports, conflicts, or unknown.",
  ].join("\n");
}

function safetyInstructions(pair: Pair): string {
  return [
    `Independently verify deletion safety for PAIR_ID=${JSON.stringify(pair.id)}.`,
    `SOURCE_FACT_ID=${JSON.stringify(pair.source.id)} SOURCE=${JSON.stringify({
      sourceIdentity: pair.source.source.id,
      role: pair.source.source.role,
      authority: pair.source.source.authority,
      order: pair.source.source.order,
      scope: pair.source.source.scope,
      dependencies: pair.source.source.dependencies,
    })} TEXT=${quotedFact(pair.source)}`,
    `WITNESS_FACT_ID=${JSON.stringify(pair.witness.id)} WITNESS=${JSON.stringify({
      sourceIdentity: pair.witness.source.id,
      role: pair.witness.source.role,
      authority: pair.witness.source.authority,
      order: pair.witness.source.order,
      scope: pair.witness.source.scope,
      dependencies: pair.witness.source.dependencies,
    })} TEXT=${quotedFact(pair.witness)}`,
    `Source authority=${pair.source.source.authority}; witness authority=${pair.witness.source.authority}.`,
    `Source dependencies=${JSON.stringify(pair.source.source.dependencies)}; witness dependencies=${JSON.stringify(pair.witness.source.dependencies)}.`,
    "Return a noul probability that removing the source loses no distinct fact, negation, condition, attribution, approval constraint, or dependency.",
  ].join("\n");
}

function requestPayloadSize(
  phase: FactJudgePhase,
  questions: Readonly<Record<string, FactQuestion>>,
) {
  const payload = JSON.stringify({ phase, questions });
  const serializedBytes = new TextEncoder().encode(payload).byteLength;
  return { serializedBytes, estimatedTokens: Math.ceil(serializedBytes / 3) };
}

function planRequests(
  phase: FactJudgePhase,
  pairs: readonly Pair[],
):
  | { readonly kind: "ready"; readonly plans: readonly RequestPlan[] }
  | { readonly kind: "failure"; readonly reason: "payload-limit" } {
  const plans: RequestPlan[] = [];
  let currentPairs: Pair[] = [];
  const commit = () => {
    if (currentPairs.length === 0) return;
    const questions = Object.fromEntries(
      currentPairs.map((pair, index) => [
        `q${index + 1}`,
        {
          instructions:
            phase === "relations" ? relationInstructions(pair) : safetyInstructions(pair),
        },
      ]),
    );
    const metrics = requestPayloadSize(phase, questions);
    plans.push({
      request: { phase, questions, ...metrics },
      pairByQuestion: new Map(currentPairs.map((pair, index) => [`q${index + 1}`, pair])),
    });
    currentPairs = [];
  };

  for (const pair of pairs) {
    const tentative = [...currentPairs, pair];
    const questions = Object.fromEntries(
      tentative.map((candidate, index) => [
        `q${index + 1}`,
        {
          instructions:
            phase === "relations" ? relationInstructions(candidate) : safetyInstructions(candidate),
        },
      ]),
    );
    const metrics = requestPayloadSize(phase, questions);
    if (
      tentative.length > FACT_SELECTOR_LIMITS.maxQuestionsPerRequest ||
      metrics.serializedBytes > FACT_SELECTOR_LIMITS.maxRequestBytes ||
      metrics.estimatedTokens > FACT_SELECTOR_LIMITS.maxRequestEstimatedTokens
    ) {
      if (currentPairs.length === 0) return { kind: "failure", reason: "payload-limit" };
      commit();
      const singleQuestions = {
        q1: {
          instructions:
            phase === "relations" ? relationInstructions(pair) : safetyInstructions(pair),
        },
      };
      const singleMetrics = requestPayloadSize(phase, singleQuestions);
      if (
        singleMetrics.serializedBytes > FACT_SELECTOR_LIMITS.maxRequestBytes ||
        singleMetrics.estimatedTokens > FACT_SELECTOR_LIMITS.maxRequestEstimatedTokens
      )
        return { kind: "failure", reason: "payload-limit" };
      currentPairs.push(pair);
    } else currentPairs.push(pair);
  }
  commit();
  return { kind: "ready", plans };
}

function isRelation(value: unknown): value is FactRelation {
  return (
    value === "equivalent" ||
    value === "replaces" ||
    value === "supports" ||
    value === "conflicts" ||
    value === "unknown"
  );
}

function parseAnswers(
  plan: RequestPlan,
  value: unknown,
): Map<string, FactRelation | number> | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const expectedKeys = Object.keys(plan.request.questions);
  const answerKeys = Object.keys(value.answers);
  if (
    expectedKeys.length !== answerKeys.length ||
    answerKeys.some((key) => !expectedKeys.includes(key))
  )
    return undefined;

  const answers = new Map<string, FactRelation | number>();
  for (const key of expectedKeys) {
    const pair = plan.pairByQuestion.get(key);
    const questionAnswer = value.answers[key];
    if (pair === undefined) return undefined;
    if (plan.request.phase === "relations") {
      if (!isRelation(questionAnswer)) return undefined;
      answers.set(pair.id, questionAnswer);
    } else {
      if (
        !isRecord(questionAnswer) ||
        typeof questionAnswer.noul !== "number" ||
        !Number.isFinite(questionAnswer.noul) ||
        questionAnswer.noul < 0 ||
        questionAnswer.noul > 1
      )
        return undefined;
      answers.set(pair.id, questionAnswer.noul);
    }
  }
  return answers;
}

interface WaveSuccess {
  readonly kind: "success";
  readonly answers: ReadonlyMap<string, FactRelation | number>;
}

interface WaveFailure {
  readonly kind: "failure";
  readonly result: FactSelectionFailure;
}

type JudgeOutcome =
  | { readonly kind: "success"; readonly value: unknown }
  | {
      readonly kind: "failure";
      readonly reason: "timeout" | "caller-cancellation" | "judge-unavailable";
    };

async function runJudgeRequest(
  plan: RequestPlan,
  judge: FactJudge,
  callerSignal: AbortSignal | undefined,
  incrementRequests: () => void,
): Promise<JudgeOutcome> {
  if (callerSignal?.aborted) return { kind: "failure", reason: "caller-cancellation" };

  const controller = new AbortController();
  let cancelRequest: () => void = () => {};
  const cancelled = new Promise<JudgeOutcome>((resolve) => {
    cancelRequest = () => resolve({ kind: "failure", reason: "caller-cancellation" });
  });
  const onCallerAbort = () => {
    controller.abort();
    cancelRequest();
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<JudgeOutcome>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ kind: "failure", reason: "timeout" });
    }, FACT_SELECTOR_LIMITS.requestTimeoutMs);
  });

  incrementRequests();
  const response = Promise.resolve()
    .then(() => judge(plan.request, controller.signal, FACT_SELECTOR_LIMITS.requestTimeoutMs))
    .then(
      (value): JudgeOutcome => ({ kind: "success", value }),
      (): JudgeOutcome => ({ kind: "failure", reason: "judge-unavailable" }),
    );
  try {
    return await Promise.race([response, timeout, cancelled]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
  }
}

async function runWave(
  plans: readonly RequestPlan[],
  judge: FactJudge,
  callerSignal: AbortSignal | undefined,
  incrementRequests: () => void,
): Promise<WaveSuccess | WaveFailure> {
  const answers = new Map<string, FactRelation | number>();
  let nextPlan = 0;
  let failure: FactSelectionFailureReason | undefined;

  const worker = async () => {
    while (failure === undefined && !callerSignal?.aborted) {
      const index = nextPlan++;
      const plan = plans[index];
      if (plan === undefined) return;

      const outcome = await runJudgeRequest(plan, judge, callerSignal, incrementRequests);
      if (outcome.kind === "failure") {
        failure = outcome.reason;
        return;
      }
      const parsed = parseAnswers(plan, outcome.value);
      if (parsed === undefined) {
        failure = "malformed-judge";
        return;
      }
      for (const [pairId, answer] of parsed) answers.set(pairId, answer);
    }
  };

  const concurrency = Math.min(FACT_SELECTOR_LIMITS.maxConcurrentRequests, plans.length);
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (callerSignal?.aborted) failure = "caller-cancellation";
  if (failure !== undefined) {
    const kind =
      failure === "malformed-judge"
        ? "refused"
        : failure === "caller-cancellation"
          ? "cancelled"
          : "unavailable";
    return { kind: "failure", result: { kind, reason: failure, requests: 0 } };
  }
  return { kind: "success", answers };
}

function emptyFailure(
  kind: FactSelectionFailure["kind"],
  reason: FactSelectionFailureReason,
  requests = 0,
): FactSelectionFailure {
  return { kind, reason, requests };
}

function resolveWitness(
  unitId: string,
  retireTo: ReadonlyMap<string, string>,
  duplicateOf: ReadonlyMap<string, string>,
): string | undefined {
  let current = unitId;
  const visited = new Set<string>();
  while (retireTo.has(current) || duplicateOf.has(current)) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    current = retireTo.get(current) ?? duplicateOf.get(current) ?? current;
  }
  return current;
}

function buildRetirementMap(
  pairs: readonly Pair[],
  relations: ReadonlyMap<string, FactRelation>,
  safety: ReadonlyMap<string, number>,
  duplicateOf: ReadonlyMap<string, string>,
): Map<string, string> {
  const unitById = new Map(
    pairs.flatMap((pair) => [
      [pair.source.id, pair.source],
      [pair.witness.id, pair.witness],
    ]),
  );
  const retireTo = new Map<string, string>();
  for (const pair of pairs) {
    const relation = relations.get(pair.id);
    const noul = safety.get(pair.id);
    if (
      (relation !== "equivalent" && relation !== "replaces") ||
      noul === undefined ||
      noul < FACT_SELECTOR_LIMITS.safetyThreshold ||
      pair.source.source.origin !== "message" ||
      pair.source.approvalConstraint ||
      AUTHORITY_RANK[pair.witness.source.authority] <
        AUTHORITY_RANK[pair.source.source.authority] ||
      !pair.source.source.dependencies.every((dependency) =>
        pair.witness.source.dependencies.includes(dependency),
      )
    )
      continue;
    const previous = retireTo.get(pair.source.id);
    const previousWitness = previous === undefined ? undefined : unitById.get(previous);
    if (previousWitness === undefined || comparePosition(previousWitness, pair.witness) < 0)
      retireTo.set(pair.source.id, pair.witness.id);
  }

  for (const [sourceId, witnessId] of [...retireTo]) {
    const source = unitById.get(sourceId);
    const terminalId = resolveWitness(witnessId, retireTo, duplicateOf);
    const terminal = terminalId === undefined ? undefined : unitById.get(terminalId);
    if (
      source === undefined ||
      terminal === undefined ||
      (terminal.source.origin !== "tail" && terminal.source.origin !== "message") ||
      AUTHORITY_RANK[terminal.source.authority] < AUTHORITY_RANK[source.source.authority] ||
      !source.source.dependencies.every((dependency) =>
        terminal.source.dependencies.includes(dependency),
      )
    )
      retireTo.delete(sourceId);
  }
  return retireTo;
}

function coverageFor(
  units: readonly EvidenceUnit[],
  duplicateOf: ReadonlyMap<string, string>,
  retireTo: ReadonlyMap<string, string>,
  relations: ReadonlyMap<string, FactRelation>,
  pairs: readonly Pair[],
): FactCoverageEntry[] {
  const relationBySource = new Map<string, FactRelation>();
  for (const pair of pairs) {
    const relation = relations.get(pair.id);
    if (relation !== undefined) relationBySource.set(pair.source.id, relation);
  }
  return units.map((unit) => {
    if (unit.kind === "padding")
      return {
        unitId: unit.id,
        sourceId: unit.source.id,
        sourceOrder: unit.source.order,
        role: unit.source.role,
        authority: unit.source.authority,
        origin: unit.source.origin,
        start: unit.start,
        end: unit.end,
        text: unit.text,
        disposition: "retired",
        reason: "whitespace-only source range explicitly retired",
        rendered: false,
      };
    const duplicate = duplicateOf.has(unit.id);
    const retired = retireTo.has(unit.id);
    const witnessId = resolveWitness(unit.id, retireTo, duplicateOf);
    const disposition = duplicate ? "exact-dedup" : retired ? "retired" : "retained";
    return {
      unitId: unit.id,
      sourceId: unit.source.id,
      sourceOrder: unit.source.order,
      role: unit.source.role,
      authority: unit.source.authority,
      origin: unit.source.origin,
      start: unit.start,
      end: unit.end,
      text: unit.text,
      disposition,
      reason: duplicate
        ? "exact source slice deduplicated within matching authority, scope, dependencies, and origin"
        : retired
          ? "supported relation and independent safety verification"
          : unit.kind === "opaque"
            ? "opaque or ambiguous evidence retained"
            : unit.source.origin === "tail"
              ? "tail evidence remains in Pi context"
              : relationBySource.get(unit.id) === undefined
                ? "no reviewed replacement; retained"
                : "relation or safety verification did not authorize retirement",
      ...(witnessId === undefined || (!duplicate && !retired) ? {} : { witnessId }),
      ...(relationBySource.get(unit.id) === undefined
        ? {}
        : { relation: relationBySource.get(unit.id) }),
      rendered: disposition === "retained" && unit.source.origin === "message",
    };
  });
}

function renderSummary(
  units: readonly EvidenceUnit[],
  coverage: readonly FactCoverageEntry[],
): string {
  const dispositionById = new Map(coverage.map((entry) => [entry.unitId, entry]));
  const selected = units.filter(
    (unit) =>
      unit.source.origin === "message" &&
      unit.kind !== "padding" &&
      dispositionById.get(unit.id)?.disposition === "retained",
  );
  const bySource = new Map<string, EvidenceUnit[]>();
  for (const unit of selected) {
    const group = bySource.get(unit.source.id) ?? [];
    group.push(unit);
    bySource.set(unit.source.id, group);
  }
  const output = [
    "<selected-facts>",
    "Copied source slices; each quoted range has separate provenance.",
  ];
  for (const group of bySource.values()) {
    const source = group[0]?.source;
    if (source === undefined) continue;
    output.push(
      `[source ${JSON.stringify(source.id)} order=${source.order} role=${source.role} authority=${source.authority} scope=${JSON.stringify(source.scope)} dependencies=${JSON.stringify(source.dependencies)}]`,
    );
    for (const unit of group)
      output.push(`[${unit.start}:${unit.end}] ${JSON.stringify(unit.text)}`);
  }
  output.push("</selected-facts>");
  return output.join("\n");
}

function isCovered(prepared: PreparedInput, coverage: readonly FactCoverageEntry[]): boolean {
  const bySource = new Map<string, FactCoverageEntry[]>();
  for (const entry of coverage) {
    const entries = bySource.get(entry.sourceId) ?? [];
    entries.push(entry);
    bySource.set(entry.sourceId, entries);
  }
  for (const source of prepared.sources) {
    const entries = (bySource.get(source.id) ?? []).sort((left, right) => left.start - right.start);
    let offset = 0;
    for (const entry of entries) {
      if (
        entry.start !== offset ||
        entry.end < entry.start ||
        entry.text !== source.text.slice(entry.start, entry.end)
      )
        return false;
      offset = entry.end;
    }
    if (offset !== source.text.length) return false;
  }
  return [...bySource.keys()].every((sourceId) =>
    prepared.sources.some((source) => source.id === sourceId),
  );
}

function pairDecisions(
  pairs: readonly Pair[],
  relations: ReadonlyMap<string, FactRelation>,
  safety: ReadonlyMap<string, number>,
  retireTo: ReadonlyMap<string, string>,
  duplicateOf: ReadonlyMap<string, string>,
): FactPairDecision[] {
  return pairs.map((pair) => {
    const relation = relations.get(pair.id);
    const witness = resolveWitness(pair.source.id, retireTo, duplicateOf);
    return {
      pairId: pair.id,
      sourceFactId: pair.source.id,
      witnessFactId: pair.witness.id,
      relation: relation ?? "unreviewed",
      ...(safety.has(pair.id) ? { safetyNoul: safety.get(pair.id) } : {}),
      retired: witness !== pair.source.id && retireTo.has(pair.source.id),
    };
  });
}

export async function selectFacts(
  input: FactInput,
  judge: FactJudge,
  options: FactSelectionOptions = {},
): Promise<FactSelectionResult> {
  if (options.signal?.aborted) return emptyFailure("cancelled", "caller-cancellation");

  const normalized = normalizeSources(input);
  if (normalized.kind === "failure") return emptyFailure("refused", normalized.reason);
  const { prepared } = normalized;
  if (prepared.sourceChars === 0) return emptyFailure("refused", "irreducible");

  const duplicateOf = exactDeduplication(prepared.units);
  const pairs = proposePairs(prepared.units, duplicateOf);
  const relationPlan = planRequests("relations", pairs);
  if (relationPlan.kind === "failure") return emptyFailure("refused", relationPlan.reason);
  if (options.signal?.aborted) return emptyFailure("cancelled", "caller-cancellation");

  let requests = 0;
  const relations = new Map<string, FactRelation>();
  if (relationPlan.plans.length > 0) {
    const relationWave = await runWave(
      relationPlan.plans,
      judge,
      options.signal,
      () => (requests += 1),
    );
    if (relationWave.kind === "failure") return { ...relationWave.result, requests };
    for (const [pairId, value] of relationWave.answers) {
      if (typeof value !== "string") return emptyFailure("refused", "malformed-judge", requests);
      relations.set(pairId, value);
    }
  }

  if (options.signal?.aborted) return emptyFailure("cancelled", "caller-cancellation", requests);
  const safetyPairs = pairs.filter((pair) => {
    const relation = relations.get(pair.id);
    return relation === "equivalent" || relation === "replaces";
  });
  const safetyPlan = planRequests("safety", safetyPairs);
  if (safetyPlan.kind === "failure") return emptyFailure("refused", safetyPlan.reason, requests);

  const safety = new Map<string, number>();
  if (safetyPlan.plans.length > 0) {
    const safetyWave = await runWave(
      safetyPlan.plans,
      judge,
      options.signal,
      () => (requests += 1),
    );
    if (safetyWave.kind === "failure") return { ...safetyWave.result, requests };
    for (const [pairId, value] of safetyWave.answers) {
      if (typeof value !== "number") return emptyFailure("refused", "malformed-judge", requests);
      safety.set(pairId, value);
    }
  }

  if (options.signal?.aborted) return emptyFailure("cancelled", "caller-cancellation", requests);
  return finishSelection(prepared, duplicateOf, pairs, relations, safety, requests);
}

function finishSelection(
  prepared: PreparedInput,
  duplicateOf: ReadonlyMap<string, string>,
  pairs: readonly Pair[],
  relations: ReadonlyMap<string, FactRelation>,
  safety: ReadonlyMap<string, number>,
  requests: number,
): FactSelectionResult {
  const retireTo = buildRetirementMap(pairs, relations, safety, duplicateOf);
  const coverage = coverageFor(prepared.units, duplicateOf, retireTo, relations, pairs);
  if (!isCovered(prepared, coverage)) return emptyFailure("refused", "invalid-input", requests);

  const summary = renderSummary(prepared.units, coverage);
  const wrappedChars = summary.length;
  const estimatedTokens = Math.ceil(new TextEncoder().encode(summary).byteLength / 3);
  const fitsChars = wrappedChars <= Math.floor(prepared.sourceChars * 0.2);
  if (!fitsChars) return emptyFailure("refused", "irreducible", requests);
  if (estimatedTokens > prepared.piTokenBudget)
    return emptyFailure("refused", "capacity", requests);
  return {
    kind: "success",
    summary,
    firstKeptEntryId: prepared.firstKeptEntryId,
    sourceChars: prepared.sourceChars,
    wrappedChars,
    estimatedTokens,
    requests,
    coverage,
    pairs: pairDecisions(pairs, relations, safety, retireTo, duplicateOf),
  };
}
