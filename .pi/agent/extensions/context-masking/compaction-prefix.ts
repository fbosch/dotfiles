import { estimateTokens, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { restoreCheckpointFiles } from "./hybrid-summary";

type Preparation = SessionBeforeCompactEvent["preparation"];
type Message = Preparation["messagesToSummarize"][number];

// Bound both dense tool output and long sequences of tiny messages before doing archive or model work.
const PREFIX_MESSAGES = 256;
const PREFIX_TOKENS = 24_000;

function prefixFileOps(messages: Message[]): Preparation["fileOps"] {
  const ops: Preparation["fileOps"] = { read: new Set(), written: new Set(), edited: new Set() };
  for (const message of messages) {
    const calls = message.role === "assistant" ? message.content.filter(block => block.type === "toolCall")
      : message.role === "toolResult" ? message.nestedCalls?.calls ?? [] : [];
    for (const call of calls) {
      const path = call.arguments?.path;
      if (typeof path !== "string" || !path) continue;
      if (call.name === "read") ops.read.add(path);
      if (call.name === "write") ops.written.add(path);
      if (call.name === "edit") ops.edited.add(path);
    }
  }
  return ops;
}

export function smallerPrefix(event: SessionBeforeCompactEvent, afterTokenCap = false): Preparation | undefined {
  const { preparation, branchEntries } = event;
  const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const limit = afterTokenCap ? Math.min(PREFIX_MESSAGES, Math.floor(messages.length / 2)) : PREFIX_MESSAGES;
  let end = 0, tokens = 0;
  while (end < messages.length && end < limit) {
    tokens += estimateTokens(messages[end]!);
    if (tokens > PREFIX_TOKENS) break;
    end++;
  }
  if (end === messages.length) return undefined;
  // Pi hands us the projected messages. Only cut at an identifiable original turn/call
  // boundary; never guess an entry ID from duplicated timestamps or rewritten content.
  const ids = new Map(branchEntries.flatMap(entry =>
    entry.type === "message" ? [[entry.message, entry.id] as const] : []));
  const boundaryId = (index: number) => {
    const next = messages[index];
    return next?.role === "user" || next?.role === "assistant" ? ids.get(next) : undefined;
  };
  let cut = end;
  while (cut > 0 && !boundaryId(cut)) cut--;
  // If the first indivisible message or call group alone exceeds the target, take
  // just that group rather than falling back to the entire original span.
  if (!cut) {
    cut = end + 1;
    while (cut < messages.length && !boundaryId(cut)) cut++;
  }
  const firstKeptEntryId = boundaryId(cut);
  if (!firstKeptEntryId) return undefined;
  const prefix = messages.slice(0, cut);
  return restoreCheckpointFiles({ ...preparation, firstKeptEntryId,
    messagesToSummarize: prefix, turnPrefixMessages: [], isSplitTurn: false,
    fileOps: prefixFileOps(prefix),
  }, branchEntries);
}
