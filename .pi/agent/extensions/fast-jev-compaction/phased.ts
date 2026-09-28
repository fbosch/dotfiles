export interface PhasedSourceSpan {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly mandatory: boolean;
  readonly retirementEligible?: boolean;
  readonly retirementWitness?: boolean;
  readonly toolCallId?: string;
  readonly toolCallPart?: "call" | "result";
}

export interface PhasedCandidate {
  readonly id: string;
  readonly spans: readonly PhasedSourceSpan[];
  readonly judgment: "retain" | "retire";
  readonly groupId: string;
  readonly witness?: { readonly groupId: string; readonly spans: readonly PhasedSourceSpan[] };
}

export type PhasedPhase = "coarse" | "refine";
export type PhasedReason =
  | "cancelled"
  | "caller-cancellation"
  | "timeout"
  | "missing-credentials"
  | "auth-failure"
  | "request-failure"
  | "body-failure"
  | "http-status"
  | "invalid-json"
  | "oversized-body"
  | "malformed-jev"
  | "no-source-spans"
  | "source-span-limit"
  | "insufficient-savings"
  | "local-state-too-large"
  | "unexpected"
  | "protected-too-large"
  | "final-size-limit";

export type PhasedJudgeResult<TDiagnostic> =
  | { readonly kind: "answers"; readonly answers: Readonly<Record<string, number>> }
  | {
      readonly kind: "unavailable";
      readonly reason: PhasedReason;
      readonly diagnostic?: TDiagnostic;
    }
  | { readonly kind: "refused"; readonly reason: PhasedReason; readonly diagnostic?: TDiagnostic }
  | {
      readonly kind: "cancelled";
      readonly reason: "caller-cancellation";
      readonly diagnostic?: TDiagnostic;
    };

export type PhasedSelectionResult<TDiagnostic> =
  | {
      readonly kind: "success";
      readonly selected: readonly PhasedSourceSpan[];
      readonly requests: number;
      readonly durationMs: number;
      readonly wrappedChars: number;
    }
  | {
      readonly kind: "unavailable" | "refused" | "cancelled";
      readonly reason: PhasedReason;
      readonly diagnostic?: TDiagnostic;
      readonly requests: number;
      readonly durationMs: number;
      readonly selection: PhasedSelectionDiagnostic;
    };

export type PhasedDiagnosticPhase = "preflight" | "coarse" | "refine";

export interface PhasedSelectionDiagnostic {
  readonly phase: PhasedDiagnosticPhase;
  readonly protectedChars: number;
  readonly candidateChars: number;
  readonly afterChars: number;
}

export interface PhasedSelectionOptions<TDiagnostic> {
  readonly originalChars: number;
  readonly signal?: AbortSignal;
  readonly deadlineMs: number;
  readonly maxItemsPerRequest: number;
  readonly preflight: (phase: PhasedPhase, candidates: readonly PhasedCandidate[]) => boolean;
  readonly judge: (
    phase: PhasedPhase,
    candidates: readonly PhasedCandidate[],
    signal: AbortSignal,
    remainingMs: number,
  ) => Promise<PhasedJudgeResult<TDiagnostic>>;
  readonly render: (selected: readonly PhasedSourceSpan[]) => string;
  readonly wrappedChars: (rendered: string) => number;
  readonly fitsPiBudget: (rendered: string) => boolean;
}

interface EvidenceGroup {
  readonly id: string;
  readonly spans: readonly PhasedSourceSpan[];
  readonly mandatory: boolean;
}

const MAX_REQUESTS_PER_WAVE = 4;
const MAX_QUESTIONS_PER_REQUEST = 16;
const MAX_QUESTIONS_PER_WAVE = MAX_REQUESTS_PER_WAVE * MAX_QUESTIONS_PER_REQUEST;
const MAX_REFINEMENT_SPANS_PER_CHUNK = 16;
const KEEP_THRESHOLD = 0.7;

function spanIdentity(span: PhasedSourceSpan): string {
  return JSON.stringify([
    span.kind,
    span.source,
    span.start,
    span.end,
    span.text,
    span.toolCallId ?? null,
    span.toolCallPart ?? null,
    span.retirementEligible === true ? "historical" : "current",
    span.retirementWitness === true,
  ]);
}

function deduplicateSpans(spans: readonly PhasedSourceSpan[]): PhasedSourceSpan[] {
  const seen = new Map<string, PhasedSourceSpan>();
  for (const span of spans) {
    const key = spanIdentity(span);
    const existing = seen.get(key);
    if (existing === undefined) seen.set(key, span);
    else
      seen.set(key, {
        ...existing,
        mandatory: existing.mandatory || span.mandatory,
        ...(existing.retirementEligible || span.retirementEligible
          ? { retirementEligible: true }
          : {}),
        ...(existing.retirementWitness || span.retirementWitness
          ? { retirementWitness: true }
          : {}),
      });
  }
  return [...seen.values()];
}

function groupEvidence(spans: readonly PhasedSourceSpan[]): EvidenceGroup[] {
  const groups = new Map<string, PhasedSourceSpan[]>();
  for (const span of spans) {
    const origin = span.retirementEligible === true ? "historical" : "current";
    const key =
      span.toolCallId === undefined
        ? JSON.stringify([span.kind, span.source, origin])
        : JSON.stringify(["tool-call", span.toolCallId, origin]);
    const group = groups.get(key) ?? [];
    group.push(span);
    groups.set(key, group);
  }
  return [...groups.values()].map((group, index) => ({
    id: `g${index + 1}`,
    spans: group,
    mandatory: group.some((span) => span.mandatory),
  }));
}

function withCallDependencies(
  allSpans: readonly PhasedSourceSpan[],
  selected: readonly PhasedSourceSpan[],
): PhasedSourceSpan[] {
  const selectedIds = new Set(selected.map((span) => span.id));
  for (const span of allSpans) {
    if (
      span.toolCallPart !== "result" ||
      span.toolCallId === undefined ||
      !selectedIds.has(span.id)
    )
      continue;
    for (const call of allSpans) {
      if (call.toolCallPart === "call" && call.toolCallId === span.toolCallId)
        selectedIds.add(call.id);
    }
  }
  return allSpans.filter((span) => selectedIds.has(span.id));
}

function completeAnswers(
  result: PhasedJudgeResult<unknown>,
  candidates: readonly PhasedCandidate[],
): result is Extract<PhasedJudgeResult<unknown>, { readonly kind: "answers" }> {
  if (result.kind !== "answers") return false;
  const names = candidates.map((candidate) => `${candidate.judgment}_${candidate.id}`);
  const keys = Object.keys(result.answers);
  if (keys.length !== names.length || keys.some((key) => !names.includes(key))) return false;
  return names.every((name) => {
    const answer = result.answers[name];
    return typeof answer === "number" && Number.isFinite(answer) && answer >= 0 && answer <= 1;
  });
}

export async function runPhasedSelection<TDiagnostic>(
  sourceSpans: readonly PhasedSourceSpan[],
  options: PhasedSelectionOptions<TDiagnostic>,
): Promise<PhasedSelectionResult<TDiagnostic>> {
  const startedAt = performance.now();
  let requests = 0;
  let phase: PhasedDiagnosticPhase = "preflight";
  let protectedChars = 0;
  let candidateChars = 0;
  let afterChars = 0;
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  const fail = (
    kind: "unavailable" | "refused" | "cancelled",
    reason: PhasedReason,
    diagnostic?: TDiagnostic,
  ): PhasedSelectionResult<TDiagnostic> => ({
    kind,
    reason,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    requests,
    durationMs: elapsed(),
    selection: { phase, protectedChars, candidateChars, afterChars },
  });

  if (options.signal?.aborted) return fail("cancelled", "caller-cancellation");
  const spans = deduplicateSpans(sourceSpans);
  const groups = groupEvidence(spans);
  const protectedGroups = groups.filter((group) => group.mandatory);
  const optionalGroups = groups.filter((group) => !group.mandatory);
  const initiallyProtected = protectedGroups.flatMap((group) => group.spans);
  const initialRendered = options.render(initiallyProtected);
  protectedChars = options.wrappedChars(initialRendered);
  afterChars = protectedChars;
  const targetChars = Math.floor(options.originalChars * 0.2);
  const initiallyFits = protectedChars <= targetChars && options.fitsPiBudget(initialRendered);

  const witnessGroup = protectedGroups.find((group) =>
    group.spans.some((span) => span.retirementWitness),
  );
  const retirementGroups = protectedGroups.filter((group) =>
    group.spans.every((span) => span.retirementEligible === true),
  );
  const retirementCandidates: PhasedCandidate[] =
    witnessGroup === undefined
      ? []
      : retirementGroups.map((group) => ({
          id: group.id,
          spans: group.spans,
          judgment: "retire" as const,
          groupId: group.id,
          witness: { groupId: witnessGroup.id, spans: witnessGroup.spans },
        }));
  const coarseCandidates: PhasedCandidate[] = [
    ...optionalGroups.map((group) => ({
      id: group.id,
      spans: group.spans,
      judgment: "retain" as const,
      groupId: group.id,
    })),
    ...retirementCandidates,
  ];
  candidateChars = coarseCandidates.reduce(
    (sum, candidate) => sum + candidate.spans.reduce((size, span) => size + span.text.length, 0),
    0,
  );

  const maxQuestionsPerRequest = Math.min(options.maxItemsPerRequest, MAX_QUESTIONS_PER_REQUEST);
  const makeBatches = (requestPhase: PhasedPhase, candidates: readonly PhasedCandidate[]) => {
    if (!Number.isSafeInteger(maxQuestionsPerRequest) || maxQuestionsPerRequest < 1)
      return undefined;
    if (candidates.length > MAX_QUESTIONS_PER_WAVE) return undefined;
    const wave: PhasedCandidate[][] = [];
    let offset = 0;
    while (offset < candidates.length) {
      const remainingRequests = MAX_REQUESTS_PER_WAVE - wave.length;
      const remainingCandidates = candidates.length - offset;
      if (remainingRequests === 0) return undefined;
      const minimumSize = Math.max(
        1,
        remainingCandidates - (remainingRequests - 1) * maxQuestionsPerRequest,
      );
      let low = minimumSize;
      let high = Math.min(maxQuestionsPerRequest, remainingCandidates);
      let accepted: PhasedCandidate[] | undefined;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        const batch = candidates.slice(offset, offset + size);
        if (options.preflight(requestPhase, batch)) {
          accepted = batch;
          low = size + 1;
        } else {
          high = size - 1;
        }
      }
      if (accepted === undefined) return undefined;
      wave.push(accepted);
      offset += accepted.length;
    }
    return wave;
  };
  const coarseWave = makeBatches("coarse", coarseCandidates);
  if (coarseWave === undefined) return fail("refused", "local-state-too-large");
  if (!initiallyFits && retirementCandidates.length === 0)
    return fail("refused", "protected-too-large");
  if (coarseCandidates.length === 0) {
    if (!initiallyFits) return fail("refused", "protected-too-large");
    return {
      kind: "success",
      selected: withCallDependencies(spans, initiallyProtected),
      requests,
      durationMs: elapsed(),
      wrappedChars: protectedChars,
    };
  }

  const deadline = new AbortController();
  let callerCancelled = false;
  let timedOut = false;
  const onCallerAbort = () => {
    callerCancelled = true;
    deadline.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(
    () => {
      timedOut = true;
      deadline.abort();
    },
    Math.max(1, options.deadlineMs),
  );

  const runWave = async (
    requestPhase: PhasedPhase,
    wave: readonly PhasedCandidate[][],
  ): Promise<{
    readonly failure?: PhasedSelectionResult<TDiagnostic>;
    readonly decisions?: Map<string, boolean>;
  }> => {
    phase = requestPhase;
    if (callerCancelled || options.signal?.aborted)
      return { failure: fail("cancelled", "caller-cancellation") };
    const remainingMs = options.deadlineMs - elapsed();
    if (timedOut || remainingMs <= 0) return { failure: fail("unavailable", "timeout") };
    const results = await Promise.all(
      wave.map(async (candidates) => {
        requests += 1;
        try {
          return await options.judge(requestPhase, candidates, deadline.signal, remainingMs);
        } catch {
          return { kind: "refused", reason: "unexpected" } as const;
        }
      }),
    );
    if (callerCancelled || options.signal?.aborted)
      return { failure: fail("cancelled", "caller-cancellation") };
    if (timedOut || deadline.signal.aborted) return { failure: fail("unavailable", "timeout") };
    const failed = results.find((result) => result.kind !== "answers");
    if (failed !== undefined) {
      if (
        failed.kind === "unavailable" ||
        failed.kind === "refused" ||
        failed.kind === "cancelled"
      ) {
        return { failure: fail(failed.kind, failed.reason, failed.diagnostic) };
      }
      return { failure: fail("refused", "malformed-jev") };
    }

    const decisions = new Map<string, boolean>();
    for (const [index, candidates] of wave.entries()) {
      const result = results[index];
      if (result === undefined || !completeAnswers(result, candidates))
        return { failure: fail("refused", "malformed-jev") };
      for (const candidate of candidates) {
        const answerName = `${candidate.judgment}_${candidate.id}`;
        const score = result.answers[answerName];
        if (score === undefined) return { failure: fail("refused", "malformed-jev") };
        decisions.set(
          candidate.id,
          score >= (candidate.judgment === "retire" ? 0.95 : KEEP_THRESHOLD),
        );
      }
    }
    return { decisions };
  };

  try {
    const coarse = await runWave("coarse", coarseWave);
    if (coarse.failure !== undefined) return coarse.failure;
    const coarseDecisions = coarse.decisions ?? new Map<string, boolean>();
    const retiredGroupIds = new Set(
      retirementGroups
        .filter((group) => coarseDecisions.get(group.id) === true)
        .map((group) => group.id),
    );
    const mandatory = protectedGroups
      .filter((group) => !retiredGroupIds.has(group.id))
      .flatMap((group) => group.spans);
    const protectedRendered = options.render(mandatory);
    protectedChars = options.wrappedChars(protectedRendered);
    afterChars = protectedChars;
    if (protectedChars > targetChars || !options.fitsPiBudget(protectedRendered))
      return fail("refused", "protected-too-large");

    const selectedGroupIds = new Set(
      optionalGroups
        .filter((group) => coarseDecisions.get(group.id) === true)
        .map((group) => group.id),
    );
    const coarseSelected = groups
      .filter((group) =>
        group.mandatory ? !retiredGroupIds.has(group.id) : selectedGroupIds.has(group.id),
      )
      .flatMap((group) => group.spans);
    const coarseSelection = withCallDependencies(spans, coarseSelected);
    const coarseRendered = options.render(coarseSelection);
    const coarseWrappedChars = options.wrappedChars(coarseRendered);
    afterChars = coarseWrappedChars;
    if (coarseWrappedChars <= targetChars && options.fitsPiBudget(coarseRendered)) {
      return {
        kind: "success",
        selected: coarseSelection,
        requests,
        durationMs: elapsed(),
        wrappedChars: coarseWrappedChars,
      };
    }

    const refinementCandidates = optionalGroups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => {
        const chunks: PhasedCandidate[] = [];
        for (
          let offset = 0;
          offset < group.spans.length;
          offset += MAX_REFINEMENT_SPANS_PER_CHUNK
        ) {
          const chunkIndex = chunks.length + 1;
          chunks.push({
            id: `${group.id}_chunk${chunkIndex}`,
            spans: group.spans.slice(offset, offset + MAX_REFINEMENT_SPANS_PER_CHUNK),
            judgment: "retain",
            groupId: group.id,
          });
        }
        return chunks;
      });
    const refinementWave = makeBatches("refine", refinementCandidates);
    if (refinementWave === undefined) return fail("refused", "local-state-too-large");
    if (refinementWave.length === 0) return fail("refused", "final-size-limit");

    const refined = await runWave("refine", refinementWave);
    if (refined.failure !== undefined) return refined.failure;
    const refinedDecisions = refined.decisions ?? new Map<string, boolean>();
    const selectedIds = new Set(mandatory.map((span) => span.id));
    for (const candidate of refinementCandidates) {
      if (refinedDecisions.get(candidate.id) !== true) continue;
      for (const span of candidate.spans) selectedIds.add(span.id);
    }
    const selected = withCallDependencies(
      spans,
      spans.filter((span) => selectedIds.has(span.id)),
    );
    const rendered = options.render(selected);
    const wrappedChars = options.wrappedChars(rendered);
    afterChars = wrappedChars;
    if (wrappedChars > targetChars || !options.fitsPiBudget(rendered))
      return fail("refused", "final-size-limit");
    return { kind: "success", selected, requests, durationMs: elapsed(), wrappedChars };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
