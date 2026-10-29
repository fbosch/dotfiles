import { existsSync } from "node:fs";
import { saveConversationArtifact, saveMaskedTextArtifacts, type MaskedItem } from "./evidence-archive";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type SessionBoundaryDraft,
  SettingsManager,
  type TurnEndEvent,
  type TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { buildIndex, withIndex } from "./artifact-index";
import { CLASSIFIER_DEFAULTS } from "./classifier-compaction";
import { isClassifierCheckpoint, registerClassifierCompaction } from "./classifier-hook";
import { isHybridCheckpoint } from "./hybrid-summary";
import {
  estimateTokens,
  type MaskingSettings,
  parseSettings,
  placeholder,
  selectMasks,
} from "./policy";
import {
  assessmentKey,
  awaitWithAbort,
  buildRollingContext,
  classificationDue,
  collectRollingCandidates,
  commitReady,
  digestText,
  estimatedUtf8Tokens,
  packRollingRequests,
  readPendingMasks,
  recentGrowthPerTurn,
  readRollingAssessments,
  ROLLING_LIMITS,
  validateRollingDecisions,
  type RollingCandidate,
  type RollingClassifier,
  type RollingClassifierRequest,
  type RollingClassifierResponse,
} from "./masking-retention";
import { registerRecall, registerRecallPrefetch } from "./recall";
import { registerImageContext } from "./image-retention";
import { registerImageRecall } from "./image-recall";

export const CUSTOM_TYPE = "context-masking";

function loadSettings(ctx: ExtensionContext): MaskingSettings {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  if (settings.drainErrors().length > 0) throw new Error("Invalid settings");
  return parseSettings(settings.getGlobalSettings());
}

interface Dependencies {
  settings: (ctx: ExtensionContext) => MaskingSettings;
  artifactRoot: () => string;
  classify?: (
    ctx: ExtensionContext,
    request: RollingClassifierRequest,
    signal: AbortSignal,
  ) => Promise<RollingClassifierResponse>;
  deadlineMs?: number;
}

async function rollingBoundary(
  event: TurnEndEvent,
  ctx: ExtensionContext,
  settings: MaskingSettings,
  dependencies: Dependencies,
  lifecycleSignal: AbortSignal,
  generationIsCurrent: () => boolean,
): Promise<TurnEndEventResult | undefined> {
  if (event.outcome !== "completed") return undefined;

  const sessionId = ctx.sessionManager.getSessionId();
  const leafId = ctx.sessionManager.getLeafId();
  const projection = event.context.contextEntries;
  // Earlier handlers’ drafts belong to the event preview, not the committed freshness baseline.
  const projectionDigest = digestText(JSON.stringify(
    ctx.sessionManager.buildSessionProjection().entries.map((entry) => [entry.sourceEntry.id, entry.messages]),
  ));
  const isFresh = (signal: AbortSignal) =>
    !signal.aborted &&
    generationIsCurrent() &&
    ctx.sessionManager.getSessionId() === sessionId &&
    ctx.sessionManager.getLeafId() === leafId &&
    digestText(JSON.stringify(
      ctx.sessionManager.buildSessionProjection().entries.map((entry) => [
        entry.sourceEntry.id,
        entry.messages,
      ]),
    )) === projectionDigest;

  if (!isFresh(lifecycleSignal)) return undefined;
  const branch = ctx.sessionManager.getBranch();
  const assessed = readRollingAssessments(branch);
  const pendingKeys = readPendingMasks(branch);
  const candidates = collectRollingCandidates(projection, settings, new Set([...assessed, ...pendingKeys]));
  // Pending decisions still apply only while their result keeps the same body and stays outside the protected window.
  const pendingCandidates = collectRollingCandidates(projection, settings, assessed)
    .filter((candidate) => pendingKeys.has(assessmentKey(candidate.sourceId, candidate.bodyDigest)));
  const eligibleTokens = candidates.reduce((total, candidate) => total + candidate.estimatedTokens, 0);
  const usage = ctx.getContextUsage();
  // With a context estimate, a due backlog of any size is classified so decisions are complete at commit.
  const minimumBacklog = usage && usage.tokens !== null ? 1 : ROLLING_LIMITS.triggerTokens;
  const estimatedSavings = (items: readonly RollingCandidate[]) => items.reduce((total, candidate) =>
    total + candidate.estimatedTokens - estimatedUtf8Tokens(placeholder(
      { entryId: candidate.sourceId, toolName: candidate.toolName, text: candidate.text },
      join(dependencies.artifactRoot(), sessionId, `${candidate.bodyDigest}.txt`),
    )), 0);
  const assess = eligibleTokens >= minimumBacklog &&
    classificationDue(usage, eligibleTokens, recentGrowthPerTurn(branch), estimatedSavings(pendingCandidates));
  if (!assess && !commitReady(usage, estimatedSavings(pendingCandidates))) return undefined;
  const classifiable = assess ? candidates : [];

  const timeout = AbortSignal.timeout(dependencies.deadlineMs ?? ROLLING_LIMITS.deadlineMs);
  const signals = [lifecycleSignal, timeout];
  if (ctx.signal) signals.push(ctx.signal);
  const signal = AbortSignal.any(signals);
  const context = buildRollingContext(projection);
  // Rule-based masks need no classifier: superseded results, and old results too large to assess.
  const superseded = classifiable.filter((candidate) => candidate.superseded);
  const packed = packRollingRequests(context, classifiable.filter((candidate) => !candidate.superseded));
  const oversizedOld = packed.oversized.filter((candidate) =>
    candidate.turnsSince >= ROLLING_LIMITS.oversizedMaskAfterTurns
  );
  const deferredIds = new Set([...packed.deferred, ...packed.oversized]
    .filter((candidate) => !oversizedOld.includes(candidate))
    .map((candidate) => candidate.sourceId));
  const decisions = new Map<string, boolean>();
  for (const candidate of [...superseded, ...oversizedOld]) decisions.set(candidate.sourceId, false);
  const usageRecords: NonNullable<RollingClassifierResponse["usage"]>[] = [];
  let usageUnavailable = false;
  let requestCount = 0;
  let requestBytes = 0;
  let classifierDurationMs = 0;

  let classify: RollingClassifier | undefined;
  if (dependencies.classify) {
    const injected = dependencies.classify;
    classify = (request, requestSignal) => injected(ctx, request, requestSignal);
  } else {
    const model = packed.batches.length
      ? ctx.modelRegistry.getModelOfType("classifier", CLASSIFIER_DEFAULTS.provider, CLASSIFIER_DEFAULTS.model)
      : undefined;
    classify = model
      ? (request, requestSignal) =>
          ctx.modelRegistry.classify(model, request, { signal: requestSignal, maxRetries: 0 })
      : undefined;
  }

  if (!classify) {
    for (const batch of packed.batches)
      for (const candidate of batch.candidates) deferredIds.add(candidate.sourceId);
  } else {
    for (const batch of packed.batches) {
      if (!isFresh(signal)) return undefined;
      requestCount++;
      requestBytes += batch.bytes;
      const started = performance.now();
      try {
        const result = await awaitWithAbort(classify(batch.request, signal), signal);
        classifierDurationMs += performance.now() - started;
        if (!isFresh(signal)) return undefined;
        if (result.usage) usageRecords.push(result.usage);
        else usageUnavailable = true;
        const batchDecisions = validateRollingDecisions(result, batch.candidates);
        if (!batchDecisions) {
          for (const candidate of batch.candidates) deferredIds.add(candidate.sourceId);
          continue;
        }
        for (const [sourceId, keep] of batchDecisions) decisions.set(sourceId, keep);
      } catch {
        classifierDurationMs += performance.now() - started;
        if (!isFresh(signal)) return undefined;
        usageUnavailable = true;
        for (const candidate of batch.candidates) deferredIds.add(candidate.sourceId);
      }
    }
  }
  if (!isFresh(signal)) return undefined;

  const keptCandidates = candidates.filter((candidate) => decisions.get(candidate.sourceId) === true);
  const maskCandidates = candidates.filter((candidate) => decisions.get(candidate.sourceId) === false);
  const decidedMasks = [...pendingCandidates, ...maskCandidates];
  // Candidates beyond this turn's request cap are still queued for classification.
  const commit = commitReady(usage, estimatedSavings(decidedMasks), packed.deferred.length > 0);
  const archived = new Map<string, { candidate: RollingCandidate; item: MaskedItem }>();
  for (const candidate of commit ? decidedMasks : []) {
    if (!isFresh(signal)) return undefined;
    try {
      const artifact = await awaitWithAbort(
        saveConversationArtifact(
          dependencies.artifactRoot(),
          sessionId,
          candidate.text,
        ),
        signal,
      );
      if (!isFresh(signal)) return undefined;
      archived.set(candidate.sourceId, {
        candidate,
        item: { ...artifact, entryId: candidate.sourceId, archiveId: artifact.entryId, toolName: candidate.toolName },
      });
    } catch {
      if (!isFresh(signal)) return undefined;
      deferredIds.add(candidate.sourceId);
    }
  }

  const plannedMasks = [...archived.values()].map(({ candidate, item }) => {
    const replacement = placeholder(
      { entryId: candidate.sourceId, toolName: candidate.toolName, text: candidate.text },
      item.path,
    );
    const savedTokens = candidate.estimatedTokens - estimatedUtf8Tokens(replacement);
    return { candidate, item, replacement, savedTokens };
  });
  const estimatedSavedTokens = plannedMasks.reduce((total, item) => total + item.savedTokens, 0);
  const applyMasks = commit && estimatedSavedTokens >= ROLLING_LIMITS.minSavedTokens;

  const edits: SessionBoundaryDraft[] = applyMasks
    ? plannedMasks.map(({ candidate, replacement }) => ({
        type: "context_edit",
        targetId: candidate.sourceId,
        replacement: { content: [{ type: "text", text: replacement }] },
      }))
    : [];
  const catalogItems: MaskedItem[] = applyMasks
    ? plannedMasks.map(({ item }) => item)
    : [];
  const maskedIds = applyMasks
    ? new Set(plannedMasks.map(({ candidate }) => candidate.sourceId))
    : new Set<string>();
  const assessments = [
    ...keptCandidates,
    ...decidedMasks.filter((candidate) => maskedIds.has(candidate.sourceId)),
  ].map(({ sourceId, bodyDigest }) => ({ sourceId, bodyDigest }));
  const pendingMasks = decidedMasks.filter((candidate) =>
    !maskedIds.has(candidate.sourceId) && !deferredIds.has(candidate.sourceId)
  );
  const pendingIds = new Set(pendingMasks.map((candidate) => candidate.sourceId));
  const deferredCandidates = candidates.filter((candidate) => !pendingIds.has(candidate.sourceId) && (
    deferredIds.has(candidate.sourceId) || !assessments.some((item) =>
      item.sourceId === candidate.sourceId && item.bodyDigest === candidate.bodyDigest
    )
  ));
  const pendingTokens = deferredCandidates.reduce((total, candidate) => total + candidate.estimatedTokens, 0);
  const drafts: SessionBoundaryDraft[] = [...edits];
  if (catalogItems.length)
    drafts.push({
      type: "custom",
      customType: CUSTOM_TYPE,
      data: {
        items: catalogItems.map(({ entryId, archiveId, toolName, path }) => ({ entryId, archiveId, toolName, path })),
        masked: maskedIds.size,
        savedTokens: estimatedSavedTokens,
      },
    });
  drafts.push({
    type: "custom",
    customType: "context-masking-rolling",
    data: {
      version: 1,
      sourceLeafId: leafId,
      eligibleTokens,
      pendingTokens,
      assessedCount: assessments.length,
      keptCount: keptCandidates.length,
      maskedCount: maskedIds.size,
      supersededMaskedCount: superseded.filter((candidate) => maskedIds.has(candidate.sourceId)).length,
      oversizedMaskedCount: oversizedOld.filter((candidate) => maskedIds.has(candidate.sourceId)).length,
      deferredCount: deferredCandidates.length,
      estimatedSavedTokens: applyMasks ? estimatedSavedTokens : 0,
      pendingMaskCount: pendingMasks.length,
      pendingMaskTokens: estimatedSavings(pendingMasks),
      pendingMasks: pendingMasks.map(({ sourceId, bodyDigest }) => ({ sourceId, bodyDigest })),
      classifierDurationMs,
      requestCount,
      requestBytes,
      usage: requestCount > 0 && !usageUnavailable && usageRecords.length === requestCount
        ? { status: "available", requests: usageRecords }
        : { status: "unavailable" },
      assessments,
    },
  });
  if (!isFresh(signal)) return undefined;
  return { entries: [...event.entries, ...drafts] };
}

export function registerContextMasking(
  pi: Pick<ExtensionAPI, "on">,
  dependencies: Dependencies = {
    settings: loadSettings,
    artifactRoot: () => join(getAgentDir(), "cache", "context-masking"),
  },
): void {
  // Keyed by the latest compaction: the hidden set only changes when a compaction lands.
  let cached: { compactionId: string; text: string | undefined } | undefined;
  let lifecycleGeneration = 0;
  let lifecycleController = new AbortController();
  const invalidateRolling = () => {
    lifecycleGeneration++;
    lifecycleController.abort();
    lifecycleController = new AbortController();
  };
  pi.on("session_start", invalidateRolling);
  pi.on("session_tree", invalidateRolling);
  pi.on("session_compact", invalidateRolling);
  pi.on("session_shutdown", invalidateRolling);
  pi.on("context", (event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    let compactionId: string | undefined;
    let embeddedIndex = false;
    for (const entry of branch) {
      if (entry.type !== "compaction") continue;
      compactionId = entry.id;
      embeddedIndex = isClassifierCheckpoint(entry.details) || isHybridCheckpoint(entry.details);
    }
    // Classifier checkpoints already contain selected references; reindexing every artifact
    // would put intentionally omitted addresses back into active context.
    if (embeddedIndex) return undefined;
    if (compactionId === undefined) return undefined;
    let current = cached;
    if (current?.compactionId !== compactionId) {
      const visible = new Set(
        ctx.sessionManager
          .buildSessionProjection()
          .entries.filter((entry) => entry.messages.length > 0)
          .map((entry) => entry.sourceEntry.id),
      );
      current = { compactionId, text: buildIndex(branch, visible, existsSync) };
      cached = current;
    }
    if (current.text === undefined) return undefined;
    const messages = withIndex(event.messages, current.text);
    return messages === undefined ? undefined : { messages };
  });
  pi.on(
    "turn_end",
    async (event: TurnEndEvent, ctx: ExtensionContext): Promise<TurnEndEventResult | undefined> => {
      let settings: MaskingSettings;
      try {
        settings = dependencies.settings(ctx);
      } catch {
        return undefined;
      }
      if (!settings.enabled) return undefined;
      if (settings.rollingEnabled) {
        const generation = lifecycleGeneration;
        return rollingBoundary(
          event,
          ctx,
          settings,
          dependencies,
          lifecycleController.signal,
          () => lifecycleGeneration === generation,
        );
      }
      const usage = ctx.getContextUsage();
      if (usage?.tokens == null || usage.contextWindow <= 0) return undefined;
      if (usage.tokens < settings.triggerRatio * usage.contextWindow) return undefined;

      const candidates = selectMasks(event.context.contextEntries, settings);
      const written = await saveMaskedTextArtifacts(
        dependencies.artifactRoot(),
        ctx.sessionManager.getSessionId(),
        candidates,
      );
      const edits = written.map(({ candidate, path }) => ({
        candidate,
        text: placeholder(candidate, path),
      }));
      const freedTokens = estimateTokens(
        edits.reduce((sum, e) => sum + e.candidate.text.length - e.text.length, 0),
      );
      // A batch that frees little would still rewrite history and cost a cache rebuild.
      if (edits.length === 0 || freedTokens < settings.minFreedRatio * usage.tokens)
        return undefined;

      const drafts: SessionBoundaryDraft[] = edits.map(
        ({ candidate, text }): SessionBoundaryDraft => ({
          type: "context_edit",
          targetId: candidate.entryId,
          replacement: { content: [{ type: "text", text }] },
        }),
      );
      drafts.push({
        type: "custom",
        customType: CUSTOM_TYPE,
        data: {
          masked: edits.length,
          freedTokens,
          tokensBefore: usage.tokens,
          contextWindow: usage.contextWindow,
          items: written.map(({ candidate, path }) => ({
            entryId: candidate.entryId,
            toolName: candidate.toolName,
            path,
          })),
        },
      });
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Masked ${edits.length} old tool results (about ${Math.round(freedTokens / 1000)}k tokens).`,
          "info",
        );
      }
      // Boundary results replace earlier proposals, so keep entries other handlers proposed.
      return { entries: [...event.entries, ...drafts] };
    },
  );
}

export default function contextMasking(pi: ExtensionAPI): void {
  registerContextMasking(pi);
  registerClassifierCompaction(pi);
  registerImageContext(pi, () => join(getAgentDir(), "cache", "context-masking"));
  registerImageRecall(pi, () => join(getAgentDir(), "cache", "context-masking"));
  registerRecall(pi);
  registerRecallPrefetch(pi, undefined, (ctx) => {
    try {
      const settings = loadSettings(ctx);
      return settings.enabled && settings.prefetchRecall;
    } catch {
      return false;
    }
  });
}
