import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

type AgentMessage = ContextEvent["messages"][number];

import { isMatching, P } from "ts-pattern";
import { MARKER } from "./policy";

export const INDEX_TYPE = "context-masking-index";
export const MAX_INDEX_ITEMS = 40;
const MAX_CALL_CHARS = 120;

export interface MaskedItem {
  entryId: string;
  toolName: string;
  path: string;
}

const RecordPattern = {
  type: "custom",
  customType: "context-masking",
  data: { items: P.array({ entryId: P.string, toolName: P.string, path: P.string }) },
};

const oneLine = (text: string): string => {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > MAX_CALL_CHARS ? `${line.slice(0, MAX_CALL_CHARS - 1)}…` : line;
};

function describeCall(args: unknown): string | undefined {
  if (isMatching({ command: P.string }, args)) return oneLine(args.command);
  if (isMatching({ path: P.string }, args)) return oneLine(args.path);
  const json = JSON.stringify(args ?? {});
  return json === "{}" ? undefined : oneLine(json);
}

/** Tool-call descriptions by tool-result entry ID, for the results named in `ids`. */
function callsFor(branch: readonly SessionEntry[], ids: ReadonlySet<string>): Map<string, string> {
  const resultCalls = new Map<string, string>();
  for (const entry of branch) {
    if (ids.has(entry.id) && entry.type === "message" && entry.message.role === "toolResult") {
      resultCalls.set(entry.message.toolCallId, entry.id);
    }
  }
  const described = new Map<string, string>();
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    for (const block of entry.message.content) {
      const resultId = block.type === "toolCall" ? resultCalls.get(block.id) : undefined;
      if (block.type === "toolCall" && resultId !== undefined) {
        const call = describeCall(block.arguments);
        if (call !== undefined) described.set(resultId, call);
      }
    }
  }
  return described;
}

/**
 * Lists masked results whose placeholders a compaction has removed from context, so their
 * saved files stay discoverable. `visibleIds` are source entries still in model context.
 */
export function buildIndex(
  branch: readonly SessionEntry[],
  visibleIds: ReadonlySet<string>,
  exists: (path: string) => boolean,
): string | undefined {
  const items = new Map<string, MaskedItem>();
  for (const entry of branch) {
    const record: unknown = entry;
    if (!isMatching(RecordPattern, record)) continue;
    for (const item of record.data.items) items.set(item.entryId, item);
  }
  const hidden = [...items.values()].filter(
    (item) => !visibleIds.has(item.entryId) && exists(item.path),
  );
  if (hidden.length === 0) return undefined;
  const shown = hidden.slice(-MAX_INDEX_ITEMS);
  const calls = callsFor(branch, new Set(shown.map((item) => item.entryId)));
  const lines = shown.map((item) => {
    const call = calls.get(item.entryId);
    return `- ${item.toolName}${call === undefined ? "" : ` \`${call}\``}: ${item.path}`;
  });
  const omitted = hidden.length - shown.length;
  return [
    `${MARKER} Tool results saved before the last compaction. Read a file with offset and limit if you need its full output again.`,
    ...lines,
    ...(omitted > 0 ? [`(${omitted} older saved results not listed.)`] : []),
  ].join("\n");
}

/** Inserts the index right after the compaction summary, where it stays stable until the next compaction. */
export function withIndex(
  messages: readonly AgentMessage[],
  text: string,
): AgentMessage[] | undefined {
  const at = messages.findIndex((message) => message.role === "compactionSummary");
  const summary = messages[at];
  if (summary === undefined) return undefined;
  const index: AgentMessage = {
    role: "custom",
    customType: INDEX_TYPE,
    content: text,
    display: false,
    // The summary's timestamp keeps the inserted message identical across requests.
    timestamp: summary.timestamp,
  };
  return [...messages.slice(0, at + 1), index, ...messages.slice(at + 1)];
}
