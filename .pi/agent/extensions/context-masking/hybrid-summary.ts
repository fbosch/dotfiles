import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { byteLength, type EvidenceArtifact } from "./classifier-compaction";

export const HYBRID_CHECKPOINT = "context-masking-hybrid-compaction";
export function isHybridCheckpoint(details: unknown): boolean {
  return isMatching({ type: HYBRID_CHECKPOINT, version: 1, artifactIndex: "external" }, details);
}
type Preparation = SessionBeforeCompactEvent["preparation"];

export function prepareHybridSummary(
  preparation: Preparation,
  evidence: readonly EvidenceArtifact[],
  maxBytes: number,
): Preparation | undefined {
  const selected = new Map(evidence.map(item => [item.toolCallId, item]));
  const messages: Preparation["messagesToSummarize"] = [];
  for (const message of [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]) {
    if (message.role === "assistant") {
      const content = message.content.filter(block =>
        block.type !== "toolCall" || selected.get(block.id)?.action !== "omit");
      if (content.length) messages.push({ ...message, content });
    } else if (message.role === "toolResult") {
      const item = selected.get(message.toolCallId);
      if (!item) messages.push(message);
      else if (item.action !== "omit") messages.push({
        ...message,
        content: [{ type: "text", text: "[Saved evidence: " + item.path +
          (item.partial ? "; partial excerpt, further content available through recall" : "") + "]\n" + item.content }],
      });
    } else messages.push(message);
  }
  if (byteLength(JSON.stringify(messages)) + byteLength(preparation.previousSummary ?? "") > maxBytes)
    return undefined;
  // Consolidate the selected chronological prefix into one rolling native summary.
  // The kept boundary and original file operations remain unchanged.
  return { ...preparation, messagesToSummarize: messages, turnPrefixMessages: [], isSplitTurn: false };
}

export function restoreCheckpointFiles(
  preparation: Preparation,
  branch: SessionBeforeCompactEvent["branchEntries"],
): Preparation {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== "compaction") continue;
    if (isMatching({
      readFiles: P.array(P.string), modifiedFiles: P.array(P.string),
    }, entry.details)) {
      const fileOps = {
        read: new Set([...preparation.fileOps.read, ...entry.details.readFiles]),
        written: new Set(preparation.fileOps.written),
        edited: new Set([...preparation.fileOps.edited, ...entry.details.modifiedFiles]),
      };
      return { ...preparation, fileOps };
    }
    break;
  }
  return preparation;
}
