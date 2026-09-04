import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateQuickReplies, type QuickReply, type QuickReplyInput } from "../generator";

interface QuickReplyQualityFixture {
  readonly name: string;
  readonly input: QuickReplyInput;
  readonly modelSuggestions: readonly QuickReply[];
  readonly expectedReplies?: readonly QuickReply[];
  readonly requiredMessagePatterns: readonly RegExp[];
  readonly forbiddenMessagePatterns?: readonly RegExp[];
}

const qualityFixtures: readonly QuickReplyQualityFixture[] = [
  {
    name: "completed work advances without repeating the implementation",
    input: {
      userText: "fix the retry lifecycle",
      assistantText: "Fixed the retry lifecycle and ran the focused tests successfully.",
    },
    modelSuggestions: [
      { label: "Run full tests", message: "Run the full test suite" },
      { label: "Show lifecycle diff", message: "Show the lifecycle diff" },
    ],
    requiredMessagePatterns: [/full test suite/i, /lifecycle diff/i],
    forbiddenMessagePatterns: [/fix the retry lifecycle/i, /focused tests/i],
  },
  {
    name: "an explicit choice produces direct answers",
    input: {
      userText: "which output should we use?",
      assistantText: "Choose compact output or detailed output.",
    },
    modelSuggestions: [
      { label: "Use compact output", message: "Use compact output" },
      { label: "Use detailed output", message: "Use detailed output" },
    ],
    requiredMessagePatterns: [/compact output/i, /detailed output/i],
  },
  {
    name: "a blocker requests concrete missing input or diagnostics",
    input: {
      userText: "run the fixture test",
      assistantText: "Blocked because the fixture path is missing. Which path should I use?",
    },
    modelSuggestions: [
      { label: "Use tests/fixtures", message: "Use tests/fixtures" },
      { label: "Show missing path", message: "Show the missing fixture path" },
    ],
    requiredMessagePatterns: [/tests\/fixtures/i, /missing fixture path/i],
    forbiddenMessagePatterns: [/go ahead/i, /try again/i],
  },
  {
    name: "a terse follow-up uses prior context for continuity",
    input: {
      userText: "do that",
      assistantText: "Applied option A.",
      recentContext: [
        { role: "user", text: "Compare option A with option B." },
        { role: "assistant", text: "Option A is simpler; option B is more configurable." },
      ],
    },
    modelSuggestions: [
      { label: "run full checks", message: "run full checks" },
      { label: "show option A diff", message: "show the option A diff" },
    ],
    requiredMessagePatterns: [/full checks/, /option A diff/],
    forbiddenMessagePatterns: [/option B/i],
  },
  {
    name: "negated risky wording still permits safe next steps",
    input: {
      userText: "check what changed",
      assistantText: "I did not deploy or delete anything. The local configuration is ready.",
    },
    modelSuggestions: [
      { label: "Show config diff", message: "Show the local config diff" },
      { label: "Run config checks", message: "Run the local config checks" },
    ],
    requiredMessagePatterns: [/local config diff/i, /local config checks/i],
    forbiddenMessagePatterns: [/deploy/i, /delete/i],
  },
  {
    name: "an invalid candidate does not hide its valid neighbor",
    input: {
      userText: "what next?",
      assistantText: "The database change is ready for review.",
    },
    modelSuggestions: [
      { label: "Run command", message: "/delete-old-table" },
      { label: "Show schema diff", message: "Show the schema diff" },
    ],
    expectedReplies: [{ label: "Show schema diff", message: "Show the schema diff" }],
    requiredMessagePatterns: [/schema diff/i],
    forbiddenMessagePatterns: [/^\//m],
  },
  {
    name: "Danish shorthand preserves Danish letters and register",
    input: {
      userText: "fortsæt med løsningen",
      assistantText: "Ændringen er klar, og de målrettede tjek består.",
    },
    modelSuggestions: [
      { label: "kør de brede tjek", message: "kør de brede tjek" },
      { label: "vis ændringen", message: "vis ændringen" },
    ],
    requiredMessagePatterns: [/kør de brede tjek/, /vis ændringen/],
  },
];

function contextFor(
  modelSuggestions: readonly QuickReply[],
  capturePrompt: (prompt: string) => void,
): Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry"> {
  return {
    cwd: "/project",
    isProjectTrusted: () => false,
    modelRegistry: {
      find: () => ({
        provider: "openai-codex",
        id: "gpt-5.6-luna-fast",
        api: "openai-codex-responses",
      }),
      complete: async (
        _model: unknown,
        request: { messages: Array<{ content: Array<{ type: string; text?: string }> }> },
      ) => {
        const prompt = request.messages[0]?.content[0];
        if (prompt?.type === "text" && prompt.text !== undefined) capturePrompt(prompt.text);
        return {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "quick-reply-quality-fixture",
              name: "return_quick_replies",
              arguments: { suggestions: modelSuggestions },
            },
          ],
          stopReason: "toolUse",
        };
      },
    },
  } as unknown as Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry">;
}

describe("quick reply output quality fixtures", () => {
  test.each([...qualityFixtures])("$name", async (fixture) => {
    let prompt = "";

    const replies = await generateQuickReplies(
      contextFor(fixture.modelSuggestions, (value) => {
        prompt = value;
      }),
      fixture.input,
      new AbortController().signal,
    );

    expect(replies).toEqual([...(fixture.expectedReplies ?? fixture.modelSuggestions)]);
    const messages = replies.map((reply) => reply.message).join("\n");
    for (const pattern of fixture.requiredMessagePatterns) expect(messages).toMatch(pattern);
    for (const pattern of fixture.forbiddenMessagePatterns ?? []) {
      expect(messages).not.toMatch(pattern);
    }

    const payload = JSON.parse(prompt.slice(prompt.indexOf("{"))) as {
      styleSample: string;
      conversation: Array<{ role: string; text: string }>;
    };
    expect(payload.styleSample).toBe(fixture.input.userText);
    expect(payload.conversation).toEqual([
      ...(fixture.input.recentContext ?? []),
      { role: "user", text: fixture.input.userText },
      { role: "assistant", text: fixture.input.assistantText },
    ]);
  });
});
