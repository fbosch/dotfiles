import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";

export const MARKER = "[context-masking]";

export interface MaskingSettings {
  enabled: boolean;
  /** Mask once estimated context reaches this share of the context window. */
  triggerRatio: number;
  /** Tool results from the latest N assistant turns stay verbatim. */
  protectRecentTurns: number;
  /** Shorter results stay verbatim; masking them saves little. */
  minResultChars: number;
  /** Skip a batch that would free less than this share of the context. */
  minFreedRatio: number;
}

// Replay over recorded sessions favoured a 10-turn window; see benchmarks/context-masking-replay.ts.
export const DEFAULT_SETTINGS: MaskingSettings = {
  enabled: false,
  triggerRatio: 0.7,
  protectRecentTurns: 10,
  minResultChars: 800,
  minFreedRatio: 0.15,
};

const RecordPattern = P.record(P.string, P.unknown);
const SettingsPattern = {
  enabled: P.optional(P.boolean),
  triggerRatio: P.optional(P.number.gt(0).lte(1)),
  protectRecentTurns: P.optional(P.number.int().gte(1)),
  minResultChars: P.optional(P.number.int().gte(0)),
  minFreedRatio: P.optional(P.number.gte(0).lt(1)),
};

export function parseSettings(global: unknown): MaskingSettings {
  if (global === undefined) return DEFAULT_SETTINGS;
  if (!isMatching(RecordPattern, global)) throw new Error("Invalid settings");
  const value = global.contextMasking;
  if (value === undefined) return DEFAULT_SETTINGS;
  if (
    !isMatching(SettingsPattern, value) ||
    Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key))
  )
    throw new Error("Invalid contextMasking settings");
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, setting] of Object.entries(value)) {
    if (setting !== undefined) Object.assign(settings, { [key]: setting });
  }
  return settings;
}

export interface MaskCandidate {
  entryId: string;
  toolName: string;
  text: string;
}

function maskableText(message: ProjectedSessionEntry["messages"][number]): string | undefined {
  if (message.role !== "toolResult") return undefined;
  const texts: string[] = [];
  for (const block of message.content) {
    // Images have no text artifact to recall from, so their results stay verbatim.
    if (block.type !== "text") return undefined;
    texts.push(block.text);
  }
  const text = texts.join("\n");
  return text.startsWith(MARKER) ? undefined : text;
}

/** Old, large tool results outside the protected recent turns, in context order. */
export function selectMasks(
  entries: readonly ProjectedSessionEntry[],
  settings: Pick<MaskingSettings, "protectRecentTurns" | "minResultChars">,
): MaskCandidate[] {
  const assistantIndexes = entries.flatMap((entry, index) =>
    entry.messages.some((message) => message.role === "assistant") ? [index] : [],
  );
  if (assistantIndexes.length <= settings.protectRecentTurns) return [];
  const boundary = assistantIndexes[assistantIndexes.length - settings.protectRecentTurns] ?? 0;
  return entries.slice(0, boundary).flatMap((entry) => {
    const [message] = entry.messages;
    if (
      entry.sourceEntry.type !== "message" ||
      entry.messages.length !== 1 ||
      message === undefined
    )
      return [];
    const text = maskableText(message);
    if (
      text === undefined ||
      text.length < settings.minResultChars ||
      message.role !== "toolResult"
    )
      return [];
    return [{ entryId: entry.sourceEntry.id, toolName: message.toolName, text }];
  });
}

export function placeholder(candidate: MaskCandidate, artifactPath: string): string {
  const lines = candidate.text.split("\n").length;
  return (
    `${MARKER} Older ${candidate.toolName} result hidden to save context (${lines} lines, ${candidate.text.length} chars). ` +
    `Full text: ${artifactPath} — use read with offset and limit if you need it again.`
  );
}

/** chars/4, matching Pi's own context estimate. */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
