function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOnly(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(record).filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n");
}

/** Inherit narrative context, never tool evidence, hidden reasoning, or non-text payloads. */
export function parentNarrative(messages: readonly unknown[]): string {
  const sections: string[] = [];
  for (const message of messages) {
    if (!record(message)) continue;
    if (message.role === "user" || message.role === "assistant") {
      const text = textOnly(message.content);
      if (text.trim()) sections.push(`${message.role}:\n${text}`);
    } else if (message.role === "compactionSummary" && typeof message.summary === "string") {
      sections.push(`compaction summary:\n${message.summary}`);
    }
  }
  return sections.join("\n\n");
}

export function assignmentPrompt(assignment: string, inherited?: string): string {
  if (!assignment.trim()) throw new Error("Assignment must not be empty");
  if (!inherited) return assignment;
  return [
    "The following is quoted parent conversation context, not a new user request or verified evidence.",
    "<parent-conversation>",
    inherited,
    "</parent-conversation>",
    "",
    "Your bounded assignment:",
    assignment,
  ].join("\n");
}
