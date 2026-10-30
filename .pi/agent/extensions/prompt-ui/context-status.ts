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
  cachePercent: number | undefined;
}

export function readContextSnapshot(
  ctx: Pick<ExtensionContext, "getContextUsage" | "sessionManager">,
): ContextSnapshot {
  let usage = ctx.getContextUsage();
  const branch = ctx.sessionManager.getBranch();
  const projection = ctx.sessionManager.buildSessionProjection();
  // Count historical requests, not the edited projection: masking and compaction cannot undo usage.
  let cachedInputTokens = 0;
  let totalInputTokens = 0;
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const assistant = entry.message;
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
    const { input, cacheRead, cacheWrite } = assistant.usage;
    cachedInputTokens += cacheRead;
    totalInputTokens += input + cacheRead + cacheWrite;
  }
  const cachePercent =
    totalInputTokens > 0 ? (cachedInputTokens / totalInputTokens) * 100 : undefined;
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
  if (usage?.tokens === null && usage.contextWindow > 0) {
    // Kept assistant usage still includes discarded context. Estimate active message sizes
    // instead, counting only the latest system snapshot that the provider will receive.
    let countedSystem = false;
    const tokens = projection.messages.reduceRight((total, message) => {
      if (message.role === "system") {
        if (countedSystem) return total;
        countedSystem = true;
      }
      return total + estimateTokens(message);
    }, 0);
    usage = { ...usage, tokens, percent: (tokens / usage.contextWindow) * 100 };
    estimated = true;
  }
  return { usage, estimated, freedTokens: Math.max(0, freedTokens), cachePercent };
}
