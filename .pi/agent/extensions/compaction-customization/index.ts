import {
  type ExtensionAPI,
  type FileOperations,
  findCutPoint,
  getAgentDir,
  type SessionBeforeCompactEvent,
  type SessionEntry,
  SettingsManager,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";

export const KEEP_RECENT_PERCENT_KEY = "keepRecentPercent";

export type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function getCompactionSettings(
  settings: unknown,
  warn: (message: string) => void,
): Record<string, unknown> | undefined {
  if (isRecord(settings) === false || settings.compaction === undefined) return undefined;
  if (isRecord(settings.compaction) === false) {
    warn("compaction must be an object when configured.");
    return undefined;
  }
  return settings.compaction;
}

export function resolveKeepRecentPercent(
  settings: unknown,
  warn: (message: string) => void = (message) =>
    console.warn(`[compaction-customization] ${message}`),
): number | undefined {
  const compaction = getCompactionSettings(settings, warn);
  const value = compaction?.[KEEP_RECENT_PERCENT_KEY];
  if (value === undefined) return undefined;

  if (typeof value !== "number" || Number.isFinite(value) === false || value <= 0 || value >= 1) {
    warn(`${KEEP_RECENT_PERCENT_KEY} must be a finite number greater than 0 and less than 1.`);
    return undefined;
  }

  return value;
}

export function keepRecentTokensForPercent(tokensBefore: number, percent: number): number {
  return Math.max(1, Math.ceil(tokensBefore * percent));
}

function getMessage(
  entry: SessionEntry,
): CompactionPreparation["messagesToSummarize"][number] | undefined {
  return sessionEntryToContextMessages(entry)[0];
}

function messagesInRange(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
): CompactionPreparation["messagesToSummarize"] {
  return entries.slice(startIndex, endIndex).flatMap((entry) => {
    const message = getMessage(entry);
    return message === undefined ? [] : [message];
  });
}

function addFileOperationsFromMessages(
  messages: CompactionPreparation["messagesToSummarize"],
  fileOps: FileOperations,
): void {
  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const args = block.arguments;
      if (!args) continue;
      const path = typeof args.path === "string" ? args.path : undefined;
      if (!path) continue;

      switch (block.name) {
        case "read":
          fileOps.read.add(path);
          break;
        case "write":
          fileOps.written.add(path);
          break;
        case "edit":
          fileOps.edited.add(path);
          break;
      }
    }
  }
}

function addPreviousFileOperations(entries: SessionEntry[], fileOps: FileOperations): void {
  const previous = [...entries].reverse().find((entry) => entry.type === "compaction");
  if (previous === undefined || previous.fromHook === true || isRecord(previous.details) === false)
    return;

  const readFiles = previous.details.readFiles;
  if (Array.isArray(readFiles)) {
    for (const path of readFiles) {
      if (typeof path === "string") fileOps.read.add(path);
    }
  }

  const modifiedFiles = previous.details.modifiedFiles;
  if (Array.isArray(modifiedFiles)) {
    for (const path of modifiedFiles) fileOps.edited.add(path);
  }
}

function createFileOps(
  entries: SessionEntry[],
  messagesToSummarize: CompactionPreparation["messagesToSummarize"],
  turnPrefixMessages: CompactionPreparation["turnPrefixMessages"],
): FileOperations {
  const fileOps: FileOperations = {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
  addPreviousFileOperations(entries, fileOps);
  addFileOperationsFromMessages([...messagesToSummarize, ...turnPrefixMessages], fileOps);
  return fileOps;
}

function previousCompactionBoundary(entries: SessionEntry[]): { startIndex: number } {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined || entry.type !== "compaction") continue;

    const keptIndex = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
    return { startIndex: keptIndex >= 0 ? keptIndex : index + 1 };
  }

  return { startIndex: 0 };
}

// shortcut: Pi exposes findCutPoint() publicly but not prepareCompaction(). Keep this projection aligned
// with the native preparation flow until Pi exposes a public preparation builder.
export function preparePercentageCompaction(
  entries: SessionEntry[],
  preparation: CompactionPreparation,
  percent: number,
): CompactionPreparation | undefined {
  const keepRecentTokens = keepRecentTokensForPercent(preparation.tokensBefore, percent);
  const { startIndex } = previousCompactionBoundary(entries);
  const cutPoint = findCutPoint(entries, startIndex, entries.length, keepRecentTokens);
  const firstKeptEntry = entries[cutPoint.firstKeptEntryIndex];
  if (firstKeptEntry?.id === undefined) return undefined;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize = messagesInRange(entries, startIndex, historyEnd);
  const turnPrefixMessages = cutPoint.isSplitTurn
    ? messagesInRange(entries, cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
    : [];

  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore: preparation.tokensBefore,
    ...(preparation.previousSummary === undefined
      ? {}
      : { previousSummary: preparation.previousSummary }),
    fileOps: createFileOps(entries, messagesToSummarize, turnPrefixMessages),
    settings: {
      ...preparation.settings,
      keepRecentTokens,
    },
  };
}

export function applyPercentageCompaction(
  event: SessionBeforeCompactEvent,
  percent: number,
): boolean {
  const prepared = preparePercentageCompaction(event.branchEntries, event.preparation, percent);
  if (prepared === undefined) return false;

  // Mutate the preparation in place so Pi and later compaction handlers use the selected cut point.
  Object.assign(event.preparation, prepared);
  return true;
}

function loadKeepRecentPercent(ctx: { cwd: string }): number | undefined {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: false });
  return resolveKeepRecentPercent(settings.getGlobalSettings());
}

export default function compactionCustomization(pi: ExtensionAPI): void {
  pi.on("session_before_compact", (event, ctx) => {
    const percent = loadKeepRecentPercent(ctx);
    if (percent === undefined) return;

    if (applyPercentageCompaction(event, percent)) return;
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Cannot retain ${percent * 100}% of this context without discarding zero messages; compaction cancelled.`,
        "warning",
      );
    }
    return { cancel: true };
  });
}
