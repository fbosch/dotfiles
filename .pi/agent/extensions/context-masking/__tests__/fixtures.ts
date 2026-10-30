import type { ClassifierAnswer, JsonValue, NestedToolCalls } from "@earendil-works/pi-ai";
import { type ProjectedSessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { RecallClassifier } from "../recall";

/** Rates every candidate above no_match, so prefetch tests exercise lexical selection alone. */
export const approveEveryCandidate: RecallClassifier = async (input) => {
  const answers: Record<string, ClassifierAnswer> = {};
  for (const [name, question] of Object.entries(input.questions)) {
    if (question.type !== "choice") continue;
    const candidates = Object.keys(question.criteria).filter((key) => key !== "no_match");
    answers[name] = {
      type: "choice",
      choice: candidates[0] ?? "no_match",
      probabilities: Object.fromEntries([
        ...candidates.map((key) => [key, 1 / candidates.length]),
        ["no_match", 0],
      ]),
      confidence: 1,
    };
  }
  return { ok: true, value: { answers } };
};

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
    details?: JsonValue;
    nestedCalls?: NestedToolCalls;
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
      content: [{ type: "toolCall", id: `call${i}`, name: toolName, arguments: turn.args ?? { path: `file${i}` } }],
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
        ...(turn.details === undefined ? {} : { details: turn.details }),
        ...(turn.nestedCalls === undefined ? {} : { nestedCalls: turn.nestedCalls }),
        timestamp: 0,
      }),
    );
  });
  const projection = (): ProjectedSessionEntry[] => manager.buildSessionProjection().entries;
  return { manager, resultIds, projection };
}
