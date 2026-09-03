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
  {
    prose: "Can I rerun the focused tests?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Can I complete the shortcut verification?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I summarize the findings?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Would you like me to summarize the available options?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "May I organize the imports?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Can I remove the unused import?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Would you like me to take another look?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I resolve the remaining type error?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I update the if condition?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I update '/tmp/cache?a=b'?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "The update is ready; should I update the configuration?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "The tests did not fail.\n\nShould I apply the patch?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I review this really carefully?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Shall we apply the patch?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Can I save the file?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Should I move to the next step?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Is this plan good?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "Is the result correct?",
    intent: "confirmation",
    labels: ["Yes", "No"],
  },
  {
    prose: "Is it okay for me to format the files?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Would you prefer me to review the change?",
    intent: "permission",
    labels: ["Go ahead", "Not now", "Explain first"],
  },
  {
    prose: "Are you ready to continue?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Should we move on to the next step?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Should I move on to the next step?",
    intent: "continuation",
    labels: ["Continue", "Stop here"],
  },
  {
    prose: "Does this approach make sense?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "Does the plan work for you?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "Sound good?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "The configuration looks right, correct?",
    intent: "approval",
    labels: ["Looks good", "Needs changes"],
  },
  {
    prose: "Did I understand that correctly?",
    intent: "confirmation",
    labels: ["Yes", "No"],
  },
  {
    prose: "This matches what you asked for, right?",
    intent: "confirmation",
    labels: ["Yes", "No"],
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
  "Can I run it?",
  "Should I do that?",
  "Would you like me to handle the rest?",
  "Isn't this correct?",
  "Shouldn’t I continue?",
  "Should I not proceed?",
  "If the tests pass, should I apply the change?",
  "Should I apply the change if the tests pass?",
  "Would you really like me to apply the patch?",
  "Should I use a Map here?",
  "Is this ready?",
  "Are you ready?",
  "Is that okay?",
  "I can update the docs or the code. Should I proceed?",
  "Options:\n- Apply the patch\n- Leave it unchanged\n\nShould I continue?",
  "Should I delete the local file?",
  "Should I overwrite the configuration?",
  "Should I run `rm -rf ./build`?",
  "Should I git push origin main?",
  "Can I complete the purchase?",
  "Can I help with that?",
  "Should I do the work?",
  "Should I deploy to staging?",
  "Should I transfer the funds?",
  "Should I install the package?",
  "Should I merge the PR?",
  "Should I send the patch?",
  "Should I grant repository access?",
  "Should I execute this script?",
  "The account should be deleted, right?",
  "Can I access the production database?",
  "Should I complete the payment?",
  "Should I upload the build artifact?",
  "Should I release the package?",
  "Should I push the branch?",
  "Here are the available choices:\n- Apply the patch\n- Leave it unchanged\n\nShould I continue?",
  "- Apply the patch\n- Leave it unchanged\n\nShould I continue?",
  "| Option | Action |\n| --- | --- |\n| Apply | Patch |\n| Leave | Unchanged |\n\nShould I continue?",
  "I can do whatever you want, right?",
  "Nothing is ready, right?",
  "Should I run `rm -f ./build/output`?",
  "Should I run `git clean -d`?",
  "Should I run `git branch -D feature`?",
  "The patch must not be applied.\n\nShould I apply the patch?",
  "Should I go ahead with the patch?",
  "This action cannot be undone.\n\nShould I proceed?",
  "Do not run this command.\n\nShould I proceed?",
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

  test("rejects oversized prose before extraction", () => {
    const prose = `${"x".repeat(100_000)}\n\nShould I update the configuration?`;

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
