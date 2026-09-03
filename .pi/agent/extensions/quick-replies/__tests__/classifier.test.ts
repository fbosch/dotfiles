import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  classifyQuickReplyIntent,
  detectQuickReplies,
  extractFinalRelevantQuestion,
  extractVisibleAssistantProse,
  produceFixedReplies,
  type QuickReplyIntent,
} from "../classifier";

const positiveCases: Array<{
  prose: string;
  intent: QuickReplyIntent;
  labels: string[];
}> = [
  {
    prose: "Should I make the change?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Would you like me to continue?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Does that look right?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "Is that correct?",
    intent: "confirmation",
    labels: ["Yes", "No"],
  },
  {
    prose: "## Next step\n\n**Should I update the configuration?**",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "```ts\nconst ready = true;\n```\n\nShall I apply this change?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Ready for me to proceed?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Would you like me to create the PR?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
];

const negativeCases = [
  "What should this function return?",
  "How should I implement this?",
  "Should a component rerender here?",
  "Is this ready? Should I apply it?",
  "Should I update the configuration or leave it unchanged?",
  "```ts\nShould I make the change?\n```",
  "> Should I make the change?",
  "The command merely happens to end with a question mark?",
  "Options:\n- Update the configuration\n- Leave it unchanged\nShould I continue?",
  `Should I ${"review this implementation carefully ".repeat(10)}?`,
  "Should I force-push the branch?",
  "The command will force-push the branch. Is this acceptable?",
  "Should I hard-reset the Git state?",
  "Should I delete the remote branch?",
  "Should I delete the database?",
  "Should I wipe the production database?",
  "Should I wipe all data?",
  "Should I destroy the records?",
  "Should I delete the backups?",
  "Should I drop the database table?",
  "Should I deploy directly to production?",
  "Should I publish the package?",
  "Should I send the external email?",
  "Should I rotate the API credentials?",
  "Should I share the API key?",
  "Should I irreversibly overwrite the data?",
];

describe("quick reply classifier", () => {
  test.each(positiveCases)("classifies $prose", ({ prose, intent, labels }) => {
    const question = extractFinalRelevantQuestion(prose);

    expect(question).toBeDefined();
    expect(classifyQuickReplyIntent(question ?? "")).toBe(intent);
    expect(detectQuickReplies(prose).map((reply) => reply.label)).toEqual(labels);
  });

  test.each(negativeCases)("rejects %s", (prose) => {
    expect(detectQuickReplies(prose)).toEqual([]);
  });

  test("inspects only the final prose paragraph", () => {
    const prose = "Should I update the configuration?\n\nThe current configuration is valid.";

    expect(detectQuickReplies(prose)).toEqual([]);
  });

  test("extracts only visible assistant text blocks", () => {
    const message = {
      content: [
        { type: "thinking", thinking: "Should I expose this reasoning?" },
        { type: "text", text: "The change is ready." },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
        { type: "text", text: "Should I apply it?" },
      ],
    } as Pick<AssistantMessage, "content">;

    expect(extractVisibleAssistantProse(message)).toBe("The change is ready.\nShould I apply it?");
  });

  test("returns distinct fixed decisions", () => {
    for (const intent of ["permission", "continuation", "approval", "confirmation"] as const) {
      const replies = produceFixedReplies(intent);
      expect(new Set(replies.map((reply) => reply.message)).size).toBe(replies.length);
      expect(replies.every((reply) => reply.label === reply.message)).toBe(true);
    }
  });
});
