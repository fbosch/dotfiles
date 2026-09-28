export interface PhasedSourceSpan {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly mandatory: boolean;
  readonly toolCallId?: string;
  readonly toolCallPart?: "call" | "result";
}

export interface PhasedCandidate {
  readonly id: string;
  readonly spans: readonly PhasedSourceSpan[];
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
    };

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
  ]);
}

function deduplicateSpans(spans: readonly PhasedSourceSpan[]): PhasedSourceSpan[] {
  const seen = new Map<string, PhasedSourceSpan>();
  for (const span of spans) {
    const key = spanIdentity(span);
    const existing = seen.get(key);
    if (existing === undefined) seen.set(key, span);
    else if (span.mandatory && !existing.mandatory) seen.set(key, { ...existing, mandatory: true });
  }
  return [...seen.values()];
}

function groupEvidence(spans: readonly PhasedSourceSpan[]): EvidenceGroup[] {
  const groups = new Map<string, PhasedSourceSpan[]>();
  for (const span of spans) {
    const key =
      span.toolCallId === undefined
        ? JSON.stringify([span.kind, span.source])
        : JSON.stringify(["tool-call", span.toolCallId]);
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

function batches<T>(items: readonly T[], maxItems: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += maxItems) {
    result.push(items.slice(offset, offset + maxItems));
  }
  return result;
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
  const names = candidates.map((candidate) => candidate.id);
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
  });

  if (options.signal?.aborted) return fail("cancelled", "caller-cancellation");
  const spans = deduplicateSpans(sourceSpans);
  const groups = groupEvidence(spans);
  const mandatory = groups.filter((group) => group.mandatory).flatMap((group) => group.spans);
  const mandatoryRendered = options.render(mandatory);
  const mandatoryWrappedChars = options.wrappedChars(mandatoryRendered);
  if (
    mandatoryWrappedChars > Math.floor(options.originalChars * 0.2) ||
    !options.fitsPiBudget(mandatoryRendered)
  ) {
    return fail("refused", "protected-too-large");
  }

  const optionalGroups = groups.filter((group) => !group.mandatory);
  if (optionalGroups.length === 0) {
    return {
      kind: "success",
      selected: withCallDependencies(spans, mandatory),
      requests,
      durationMs: elapsed(),
      wrappedChars: mandatoryWrappedChars,
    };
  }

  const makeBatches = (phase: PhasedPhase, candidates: readonly PhasedCandidate[]) => {
    const wave = batches(candidates, options.maxItemsPerRequest);
    if (wave.length > MAX_REQUESTS_PER_WAVE) return undefined;
    if (wave.some((batch) => !options.preflight(phase, batch))) return undefined;
    return wave;
  };

  const coarseCandidates: PhasedCandidate[] = optionalGroups.map((group) => ({
    id: group.id,
    spans: group.spans,
  }));
  const coarseWave = makeBatches("coarse", coarseCandidates);
  if (coarseWave === undefined) return fail("refused", "local-state-too-large");

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
    phase: PhasedPhase,
    wave: readonly PhasedCandidate[][],
  ): Promise<{
    readonly failure?: PhasedSelectionResult<TDiagnostic>;
    readonly decisions?: Map<string, boolean>;
  }> => {
    if (callerCancelled || options.signal?.aborted)
      return { failure: fail("cancelled", "caller-cancellation") };
    const remainingMs = options.deadlineMs - elapsed();
    if (timedOut || remainingMs <= 0) return { failure: fail("unavailable", "timeout") };
    const results = await Promise.all(
      wave.map(async (candidates) => {
        requests += 1;
        try {
          return await options.judge(phase, candidates, deadline.signal, remainingMs);
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
        const score = result.answers[candidate.id];
        if (score === undefined) return { failure: fail("refused", "malformed-jev") };
        decisions.set(candidate.id, score >= KEEP_THRESHOLD);
      }
    }
    return { decisions };
  };

  try {
    const coarse = await runWave("coarse", coarseWave);
    if (coarse.failure !== undefined) return coarse.failure;
    const coarseDecisions = coarse.decisions ?? new Map<string, boolean>();
    const selectedGroupIds = new Set(
      optionalGroups
        .filter((group) => coarseDecisions.get(group.id) === true)
        .map((group) => group.id),
    );
    const coarseSelected = groups
      .filter((group) => group.mandatory || selectedGroupIds.has(group.id))
      .flatMap((group) => group.spans);
    const coarseSelection = withCallDependencies(spans, coarseSelected);
    const coarseRendered = options.render(coarseSelection);
    const coarseWrappedChars = options.wrappedChars(coarseRendered);
    if (
      coarseWrappedChars <= Math.floor(options.originalChars * 0.2) &&
      options.fitsPiBudget(coarseRendered)
    ) {
      return {
        kind: "success",
        selected: coarseSelection,
        requests,
        durationMs: elapsed(),
        wrappedChars: coarseWrappedChars,
      };
    }

    const selectedGroupSet = new Set(selectedGroupIds);
    const refinementCandidates = optionalGroups
      .filter((group) => selectedGroupSet.has(group.id))
      .flatMap((group) => group.spans)
      .map((span) => ({ id: span.id, spans: [span] }));
    const refinementWave = makeBatches("refine", refinementCandidates);
    if (refinementWave === undefined) return fail("refused", "local-state-too-large");
    if (refinementWave.length === 0) return fail("refused", "final-size-limit");

    const refined = await runWave("refine", refinementWave);
    if (refined.failure !== undefined) return refined.failure;
    const refinedDecisions = refined.decisions ?? new Map<string, boolean>();
    const mandatorySpanIds = new Set(mandatory.map((span) => span.id));
    const refinedSelected = spans.filter(
      (span) => mandatorySpanIds.has(span.id) || refinedDecisions.get(span.id) === true,
    );
    const selected = withCallDependencies(spans, refinedSelected);
    const rendered = options.render(selected);
    const wrappedChars = options.wrappedChars(rendered);
    if (wrappedChars > Math.floor(options.originalChars * 0.2) || !options.fitsPiBudget(rendered)) {
      return fail("refused", "final-size-limit");
    }
    return { kind: "success", selected, requests, durationMs: elapsed(), wrappedChars };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
