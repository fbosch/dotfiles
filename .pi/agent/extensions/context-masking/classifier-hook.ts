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
        provider: P.optional(P.string.minLength(1)),
        model: P.optional(P.string.minLength(1)),
        includeContent: P.optional(P.boolean),
        maxRequestBytes: P.optional(P.number.int().gte(1_000).lte(28_000)),
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
  const fallback = async (
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
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
        event.preparation,
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
    let settings: ClassifierSettings;
    try {
      settings = dependencies.settings(ctx);
    } catch {
      if (ctx.hasUI)
        ctx.ui.notify(
          "Invalid classifier compaction settings; using normal compaction.",
          "warning",
        );
      return fallback(event, ctx);
    }
    if (!settings.enabled) return undefined;
    if (event.signal.aborted) return { cancel: true };
    const model = ctx.modelRegistry.getModelOfType("classifier", settings.provider, settings.model);
    if (!model) {
      if (ctx.hasUI)
        ctx.ui.notify("Classifier model unavailable; using normal compaction.", "warning");
      return fallback(event, ctx);
    }
    const result = await classifyCompaction(
      {
        messages: [
          ...event.preparation.messagesToSummarize,
          ...event.preparation.turnPrefixMessages,
        ],
        branch: event.branchEntries,
        ...(event.preparation.previousSummary
          ? { previousSummary: event.preparation.previousSummary }
          : {}),
        ...(event.customInstructions ? { instructions: event.customInstructions } : {}),
      },
      settings,
      {
        artifactRoot: dependencies.artifactRoot(),
        classify: (request, signal) =>
          ctx.modelRegistry.classify(model, request, signal ? { signal } : {}),
      },
      event.signal,
    );
    const audit = {
      type: CLASSIFIER_CHECKPOINT,
      version: 1,
      mode: settings.includeContent ? "content-aware" : "metadata-only",
      model: `${settings.provider}/${settings.model}`,
      outcome: result.kind,
      reason: result.reason,
      requests: result.requestBytes.length,
      requestBytes: result.requestBytes,
      artifactBytes: result.artifactBytes,
      artifactsRead: result.artifactsRead,
      classifierMs: result.classifierMs,
      usageComplete: result.usageComplete,
      decisions: result.decisions.map(({ entryId, action, forced }) => ({
        entryId,
        action,
        forced,
      })),
      usage: result.usage,
    };
    // Failed attempts cannot attach usage to Pi's default summary. Preserve their accounting
    // separately without storing classifier packets or tool-output contents in telemetry.
    if (result.requestBytes.length) pi.appendEntry(CLASSIFIER_CHECKPOINT, audit);
    if (result.reason === "aborted") return { cancel: true };
    if (result.kind === "fallback") {
      if (ctx.hasUI) ctx.ui.notify(`Classifier compaction fell back: ${result.reason}.`, "warning");
      return fallback(event, ctx);
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
          readFiles: [...readFiles].filter((path) => !modifiedFiles.has(path)),
          modifiedFiles: [...modifiedFiles],
        },
      },
    };
  });
}
