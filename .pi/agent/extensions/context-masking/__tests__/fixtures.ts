import { type ProjectedSessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

// Builds a real session so tests exercise Pi's own projection and context edits.
export function sessionWith(
  turns: readonly {
    resultChars: number;
    tool?: string;
    image?: boolean;
    args?: Record<string, string>;
  }[],
) {
  const manager = SessionManager.inMemory("/work");
  manager.appendMessage({ role: "user", content: "task", timestamp: 0 });
  const resultIds: string[] = [];
  turns.forEach((turn, i) => {
    const toolName = turn.tool ?? "read";
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: `call${i}`, name: toolName, arguments: turn.args ?? {} }],
      api: "openai-responses",
      provider: "openai",
      model: "m",
      usage,
      stopReason: "toolUse",
      timestamp: 0,
    });
    resultIds.push(
      manager.appendMessage({
        role: "toolResult",
        toolCallId: `call${i}`,
        toolName,
        content: turn.image
          ? [
              { type: "text", text: "x".repeat(turn.resultChars) },
              { type: "image", data: "AA==", mimeType: "image/png" },
            ]
          : [{ type: "text", text: "x".repeat(turn.resultChars) }],
        isError: false,
        timestamp: 0,
      }),
    );
  });
  const projection = (): ProjectedSessionEntry[] => manager.buildSessionProjection().entries;
  return { manager, resultIds, projection };
}
