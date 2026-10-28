import { join } from "node:path";
import {
  compact,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import {
  CLASSIFIER_DEFAULTS,
  type ClassifierSettings,
  classifyCompaction,
} from "./classifier-compaction";

import { ClassifierDecisionCache } from "./classifier-cache";
import { HYBRID_CHECKPOINT, prepareHybridSummary, restoreCheckpointFiles } from "./hybrid-summary";
import { sumUsage } from "./classifier-compaction";
import { imageReferences } from "./image-retention";
import { checkpointImages, IMAGE_ARCHIVE, readImageArtifact } from "./evidence-archive";
export const CLASSIFIER_CHECKPOINT = "context-masking-classifier-compaction";

export function isClassifierCheckpoint(details: unknown): boolean {
  return isMatching(
    { type: CLASSIFIER_CHECKPOINT, version: 1, artifactIndex: "embedded" },
    details,
  );
}

export function parseClassifierSettings(global: unknown): ClassifierSettings {
  if (global === undefined) return { ...CLASSIFIER_DEFAULTS };
  if (!isMatching(P.record(P.string, P.unknown), global)) throw new Error("Invalid settings");
  const value = global.contextClassifierCompaction;
  if (value === undefined) return { ...CLASSIFIER_DEFAULTS };
  if (
    !isMatching(
      {
        enabled: P.optional(P.boolean),
        mode: P.optional(P.union("extractive", "hybrid")),
        maxSummaryInputBytes: P.optional(P.number.int().gte(1_000).lte(100_000)),
        provider: P.optional(P.string.minLength(1)),
        model: P.optional(P.string.minLength(1)),
        includeContent: P.optional(P.boolean),
        maxRequestBytes: P.optional(P.number.int().gte(1_000).lte(28_000)),
        maxConcurrentAssessments: P.optional(P.number.int().gte(1).lte(4)),
        maxArtifactBytes: P.optional(P.number.int().gte(1).lte(128_000)),
        maxTotalArtifactBytes: P.optional(P.number.int().gte(1).lte(2_000_000)),
        maxArtifacts: P.optional(P.number.int().gte(1).lte(80)),
        maxOutputBytes: P.optional(P.number.int().gte(1).lte(100_000)),
        threshold: P.optional(P.number.gte(0).lte(1)),
        minFreedRatio: P.optional(P.number.gte(0).lt(1)),
      },
      value,
    ) ||
    Object.keys(value).some((key) => !Object.hasOwn(CLASSIFIER_DEFAULTS, key))
  )
    throw new Error("Invalid contextClassifierCompaction settings");
  const settings = { ...CLASSIFIER_DEFAULTS };
  for (const [key, setting] of Object.entries(value))
    if (setting !== undefined) Object.assign(settings, { [key]: setting });
  return settings;
}

type GlobalSettings = ReturnType<SettingsManager["getGlobalSettings"]>;
interface Dependencies {
  settings: (ctx: ExtensionContext) => ClassifierSettings;
  artifactRoot: () => string;
  globalSettings?: (ctx: ExtensionContext) => unknown;
  compact?: typeof compact;
}

function loadGlobalSettings(ctx: ExtensionContext): GlobalSettings {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  if (settings.drainErrors().length) throw new Error("Invalid settings");
  return settings.getGlobalSettings();
}

export function registerClassifierCompaction(
  pi: Pick<ExtensionAPI, "on" | "appendEntry">,
  dependencies: Dependencies = {
    settings: (ctx) => parseClassifierSettings(loadGlobalSettings(ctx)),
    artifactRoot: () => join(getAgentDir(), "cache", "context-masking"),
  },
) {
  let cache = new ClassifierDecisionCache();
  let cacheSessionId: string | undefined;
  const fallback = async (
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
    preparation = event.preparation,
  ): Promise<SessionBeforeCompactResult> => {
    if (event.signal.aborted) return { cancel: true };
    try {
      const global = (dependencies.globalSettings ?? loadGlobalSettings)(ctx);
      if (
        !isMatching(
          {
            compactionModel: {
              model: P.string.minLength(1),
              thinkingLevel: P.optional(
                P.union("off", "minimal", "low", "medium", "high", "xhigh", "max"),
              ),
            },
          },
          global,
        )
      )
        throw new Error("Invalid compactionModel settings");
      const { model: modelId, thinkingLevel } = global.compactionModel;
      const separator = modelId.indexOf("/");
      if (separator <= 0 || separator === modelId.length - 1)
        throw new Error("compactionModel.model must be provider/model");
      const model = ctx.modelRegistry.find(
        modelId.slice(0, separator),
        modelId.slice(separator + 1),
      );
      if (!model) throw new Error(`Compaction model unavailable: ${modelId}`);
      // enabled controls the standalone compactor; fallback still uses its model and thinking level.
      const compaction = await (dependencies.compact ?? compact)(
        restoreCheckpointFiles(preparation, event.branchEntries),
        model,
        undefined,
        undefined,
        event.customInstructions,
        event.signal,
        thinkingLevel,
        (selected, context, options) => ctx.modelRegistry.streamSimple(selected, context, options),
      );
      return event.signal.aborted ? { cancel: true } : { compaction };
    } catch (error) {
      if (!event.signal.aborted && ctx.hasUI)
        ctx.ui.notify(
          `Classifier compaction fallback failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      // Do not retry an invalid fallback with the active conversation model.
      return { cancel: true };
    }
  };
  pi.on("session_before_compact", async (event, ctx) => {
    const imageInput = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages].some(message =>
      "content" in message && Array.isArray(message.content) && message.content.some(block => block.type === "image")) || checkpointImages(event.branchEntries).some(image => image.action !== "omit");
    let settings: ClassifierSettings;
    try {
      settings = dependencies.settings(ctx);
    } catch {
      if (ctx.hasUI)
        ctx.ui.notify(
          "Invalid classifier compaction settings; using normal compaction.",
          "warning",
        );
      return imageInput ? { cancel: true } : fallback(event, ctx);
    }
    if (!settings.enabled) return undefined;
    if (event.signal.aborted) return { cancel: true };
    const model = ctx.modelRegistry.getModelOfType("classifier", settings.provider, settings.model);
    if (!model) {
      if (ctx.hasUI)
        ctx.ui.notify("Classifier model unavailable; using normal compaction.", "warning");
      return imageInput ? { cancel: true } : fallback(event, ctx);
    }
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId !== cacheSessionId) { cache = new ClassifierDecisionCache(); cacheSessionId = sessionId; }
    const result = await classifyCompaction(
      {
        messages: [
          ...event.preparation.messagesToSummarize,
          ...event.preparation.turnPrefixMessages,
        ],
        branch: event.branchEntries,
        sessionId,
        previousImages: checkpointImages(event.branchEntries),
        ...(event.preparation.previousSummary
          ? { previousSummary: event.preparation.previousSummary }
          : {}),
        ...(event.customInstructions ? { instructions: event.customInstructions } : {}),
      },
      settings,
      {
        artifactRoot: dependencies.artifactRoot(),
        cache,
        classify: (request, signal) =>
          ctx.modelRegistry.classify(model, request, signal ? { signal } : {}),
      },
      event.signal,
    );
    if (result.images?.length) pi.appendEntry(IMAGE_ARCHIVE, { version: 1, images: result.images });
    if (result.savedItems?.length) pi.appendEntry("context-masking", { items: result.savedItems });
    if (result.reason.startsWith("conversation-archive") || result.reason === "conversation-count-limit") {
      const message = result.reason === "conversation-archive-limit"
        ? "Compaction cancelled: the conversation archive byte limit was exceeded."
        : result.reason === "conversation-count-limit"
          ? "Compaction cancelled: the conversation unit limit was exceeded."
          : "Compaction cancelled: conversation text could not be archived.";
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      return { cancel: true };
    }
    if (!event.signal.aborted && result.skippedImages?.length && ctx.hasUI) {
      const count = result.skippedImages.length;
      const sources = result.skippedImages.slice(0, 8).map(image => `${JSON.stringify(image.entryId)}:${image.blockIndex}`).join(", ");
      ctx.ui.notify(`Skipped ${count} image${count === 1 ? "" : "s"} that could not be archived (entry:block: ${sources}${count > 8 ? ", …" : ""}).`, "warning");
    }
    if (result.images?.length) {
      try {
        for (const image of result.images) await readImageArtifact(dependencies.artifactRoot(), sessionId, image);
      } catch {
        if (ctx.hasUI) ctx.ui.notify("Compaction cancelled: an archived image is unavailable.", "error");
        return { cancel: true };
      }
    }
    const imageFallback = async (preparation = event.preparation) => {
      const native = await fallback(event, ctx, preparation);
      if (!native?.compaction || !result.images?.length) return native;
      const details: unknown = native.compaction.details ?? {};
      if (!isMatching(P.record(P.string, P.unknown), details)) return { cancel: true };
      const images = result.images.map(image => ({ ...image, action: "inline" as const, forced: true }));
      return { compaction: { ...native.compaction,
        summary: native.compaction.summary + "\n\n" + imageReferences(images),
        details: { ...details, images },
      } };
    };
    let selectedPreparation: SessionBeforeCompactEvent["preparation"] | undefined;
    if (settings.mode === "hybrid" && result.kind === "retained") {
      const selected = { ...event.preparation, messagesToSummarize: [{ role: "user" as const, content: result.text, timestamp: 0 }], turnPrefixMessages: [] };
      delete selected.previousSummary;
      selectedPreparation = prepareHybridSummary(selected, [], settings.maxSummaryInputBytes);
    }
    if (settings.mode === "hybrid" && result.kind === "retained" && !selectedPreparation) {
      result.kind = "fallback"; result.reason = "summary-input-limit";
    }
    const audit = {
      type: CLASSIFIER_CHECKPOINT,
      version: 1,
      mode: settings.mode === "hybrid" ? "hybrid" : settings.includeContent ? "content-aware" : "metadata-only",
      model: `${settings.provider}/${settings.model}`,
      outcome: result.kind,
      reason: result.reason,
      requests: result.requestBytes.length,
      requestBytes: result.requestBytes,
      imageRequestLimit: result.imageRequestLimit,
      skippedImageCount: result.skippedImages?.length ?? 0,
      artifactBytes: result.artifactBytes,
      artifactsRead: result.artifactsRead,
      checkpointBytes: result.checkpointBytes,
      checkpointUnpackedBytes: result.checkpointUnpackedBytes,
      checkpointInlineBytes: result.checkpointInlineBytes,
      assessmentRequests: result.assessmentRequests ?? 0,
      reconciliationRequests: result.reconciliationRequests ?? 0,
      reconciliationIncomplete: result.reconciliationIncomplete ?? false,
      revisionNominations: result.revisionNominations ?? [],
      revisionPromotions: result.revisionPromotions ?? 0,
      budgetDemotions: result.budgetDemotions ?? 0,
      archiveWindows: result.archiveWindows ?? 0,
      expandedReferences: result.expandedReferences ?? 0,
      expandedWindows: result.expandedWindows ?? 0,
      classifierMs: result.classifierMs,
      cacheHits: result.cacheHits,
      usageComplete: result.usageComplete,
      decisions: result.decisions.map(({ id, entryId, action, forced, budgetDemoted, startLine, endLine }) => ({
        id, startLine, endLine,
        entryId,
        action,
        forced,
        budgetDemoted: budgetDemoted ?? false,
      })),
      usage: result.usage,
    };
    // Failed attempts cannot attach usage to Pi's default summary. Preserve their accounting
    // separately without storing classifier packets or tool-output contents in telemetry.
    if (result.requestBytes.length || result.cacheHits || result.imageRequestLimit || result.reason === "checkpoint-expansion-failed") pi.appendEntry(CLASSIFIER_CHECKPOINT, audit);
    if (result.reason === "aborted") return { cancel: true };
    if (result.kind === "fallback") {
      if (ctx.hasUI) ctx.ui.notify(`Classifier compaction fell back: ${result.reason}.`, "warning");
      return imageFallback();
    }
    if (settings.mode === "hybrid" && selectedPreparation) {
      const native = await fallback(event, ctx, selectedPreparation);
      if (!native?.compaction) return native;
      const nativeDetails = native.compaction.details;
      if (!isMatching({ readFiles: P.array(P.string), modifiedFiles: P.array(P.string) }, nativeDetails))
        return { cancel: true };
      const usage = result.usage ? sumUsage(native.compaction.usage, result.usage) : native.compaction.usage;
      return { compaction: {
        ...native.compaction,
        summary: native.compaction.summary + (result.imageSummary ? "\n\n" + result.imageSummary : "") + "\n\nSaved tool evidence is available through recall; discover it with tool_search.",
        ...(usage ? { usage } : {}),
        details: { ...nativeDetails, ...audit, type: HYBRID_CHECKPOINT,
          artifactIndex: "external", ...(result.images ? { images: result.images } : {}), usageComplete: audit.usageComplete && !!native.compaction.usage },
      } };
    }
    const readFiles = new Set(event.preparation.fileOps.read);
    const modifiedFiles = new Set([
      ...event.preparation.fileOps.written,
      ...event.preparation.fileOps.edited,
    ]);
    for (let i = event.branchEntries.length - 1; i >= 0; i--) {
      const entry = event.branchEntries[i];
      if (entry?.type !== "compaction") continue;
      if (
        isClassifierCheckpoint(entry.details) &&
        isMatching(
          {
            readFiles: P.array(P.string),
            modifiedFiles: P.array(P.string),
          },
          entry.details,
        )
      ) {
        for (const path of entry.details.readFiles) readFiles.add(path);
        for (const path of entry.details.modifiedFiles) modifiedFiles.add(path);
      }
      break;
    }
    return {
      compaction: {
        summary: result.text,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        ...(result.usage ? { usage: result.usage } : {}),
        details: {
          ...audit,
          artifactIndex: "embedded",
          ...(result.images ? { images: result.images } : {}),
          readFiles: [...readFiles].filter((path) => !modifiedFiles.has(path)),
          modifiedFiles: [...modifiedFiles],
        },
      },
    };
  });
}
