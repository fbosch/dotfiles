import type { CompactionInput } from "./classifier-compaction";
import { RETENTION_GOAL } from "./image-retention";

export function retentionContext(input: CompactionInput) {
  let currentTask = input.taskContext;
  if (currentTask === undefined) for (let i = input.branch.length - 1; i >= 0; i--) {
    const entry = input.branch[i];
    if (entry?.type !== "message" || entry.message.role !== "user") continue;
    currentTask = typeof entry.message.content === "string" ? entry.message.content
      : entry.message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    break;
  }
  const previous = [...input.previousSummary ?? ""];
  return {
    goal: RETENTION_GOAL,
    compactionFocus: input.instructions ?? "",
    currentTask: currentTask ?? "",
    previousState: { text: previous.slice(0, 2_000).join(""), truncated: previous.length > 2_000 },
  };
}
