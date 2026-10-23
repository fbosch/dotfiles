import { expect, test } from "bun:test";
import { assignmentPrompt, parentNarrative } from "../context";

test("inherits only user/assistant text and explicit compaction summaries", () => {
  const narrative = parentNarrative([
    { role: "user", content: [{ type: "text", text: "user context" }, { type: "image", data: "image payload" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: "assistant context" }, { type: "toolCall", name: "bash", arguments: { command: "private command" } }] },
    { role: "toolResult", content: [{ type: "text", text: "tool evidence" }] },
    { role: "compactionSummary", summary: "compacted context" },
    { role: "custom", content: "extension content" },
  ]);
  expect(narrative).toBe("user:\nuser context\n\nassistant:\nassistant context\n\ncompaction summary:\ncompacted context");
});

test("fresh prompts do not inherit context; inherited prompts keep the assignment distinct", () => {
  expect(assignmentPrompt("Inspect the parser")).toBe("Inspect the parser");
  expect(assignmentPrompt("Inspect the parser", "assistant:\nEarlier conclusion")).toContain("Your bounded assignment:\nInspect the parser");
  expect(() => assignmentPrompt("  ")).toThrow("Assignment must not be empty");
});

test("malformed blocks cannot become tool or image text through coercion", () => {
  expect(parentNarrative([null, { role: "user", content: [null, { type: "text", text: {} }, { type: "image", text: "image annotation" }] }])).toBe("");
});
