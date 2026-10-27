import { existsSync } from "node:fs";
import { saveMaskedTextArtifacts } from "./evidence-archive";
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
import { isClassifierCheckpoint, registerClassifierCompaction } from "./classifier-hook";
import { isHybridCheckpoint } from "./hybrid-summary";
import {
  estimateTokens,
  type MaskingSettings,
  parseSettings,
  placeholder,
  selectMasks,
} from "./policy";
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
