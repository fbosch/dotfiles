import {
  calculateContextTokens,
  type ExtensionContext,
  estimateTokens,
} from "@earendil-works/pi-coding-agent";
import { savedItems } from "../context-masking/evidence-archive";
import { MARKER } from "../context-masking/policy";

export interface ContextSnapshot {
  usage: ReturnType<ExtensionContext["getContextUsage"]>;
  estimated: boolean;
  freedTokens: number;
}

export function readContextSnapshot(
  ctx: Pick<ExtensionContext, "getContextUsage" | "sessionManager">,
): ContextSnapshot {
  const usage = ctx.getContextUsage();
  const branch = ctx.sessionManager.getBranch();
  const projection = ctx.sessionManager.buildSessionProjection();
  const saved = savedItems(branch);
  let freedTokens = 0;
  let lastMessage: (typeof projection.messages)[number] | undefined;
  let lastSourceId: string | undefined;
  for (const entry of projection.entries) {
    if (entry.messages.length > 0) {
      lastMessage = entry.messages.at(-1);
      lastSourceId = entry.sourceEntry.id;
    }
    // Compare originals with active masks in memory; archived results occupy no active context.
    if (
      entry.sourceEntry.type === "message" &&
      entry.sourceEntry.message.role === "toolResult" &&
      saved.has(entry.sourceEntry.id) &&
      entry.messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.content.some((block) => block.type === "text" && block.text.startsWith(MARKER)),
      )
    ) {
      freedTokens +=
        estimateTokens(entry.sourceEntry.message) -
        entry.messages.reduce((total, message) => total + estimateTokens(message), 0);
    }
  }
  const measured =
    lastMessage?.role === "assistant" &&
    lastMessage.stopReason !== "aborted" &&
    lastMessage.stopReason !== "error" &&
    calculateContextTokens(lastMessage.usage) > 0;
  let estimated = !measured;
  if (measured) {
    const index = branch.findIndex((entry) => entry.id === lastSourceId);
    // Later edits invalidate provider usage even when they replace much older messages.
    estimated = branch
      .slice(index + 1)
      .some((entry) => entry.type === "context_edit" || entry.type === "compaction");
  }
  return { usage, estimated, freedTokens: Math.max(0, freedTokens) };
}
