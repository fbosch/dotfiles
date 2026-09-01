import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import askUserQuestion, { type AskUserQuestionResultDetails } from "../ask-user-question";

interface QuestionParams {
  question: string;
  details?: string;
  options?: Array<{ label: string; value?: string; description?: string }>;
  multiSelect?: boolean;
}

interface QuestionResult {
  content: Array<{ type: "text"; text: string }>;
  details: AskUserQuestionResultDetails;
}

interface RegisteredQuestionTool {
  execute(
    toolCallId: string,
    params: QuestionParams,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<QuestionResult>;
}

function registerQuestionTool(): RegisteredQuestionTool {
  let registeredTool: RegisteredQuestionTool | undefined;
  const pi = {
    registerTool(tool: unknown) {
      registeredTool = tool as RegisteredQuestionTool;
    },
  } as unknown as ExtensionAPI;

  askUserQuestion(pi);
  if (registeredTool === undefined) throw new Error("Question tool was not registered");
  return registeredTool;
}

function createContext(options: {
  selections?: string[];
  editorAnswers?: Array<string | undefined>;
  hasUI?: boolean;
}): ExtensionContext {
  const selections = [...(options.selections ?? [])];
  const editorAnswers = [...(options.editorAnswers ?? [])];

  return {
    hasUI: options.hasUI ?? true,
    ui: {
      editor: async () => editorAnswers.shift(),
      notify: () => undefined,
      select: async () => selections.shift(),
    },
  } as unknown as ExtensionContext;
}

describe("ask_user_question", () => {
  test("returns a free-form answer", async () => {
    const result = await registerQuestionTool().execute(
      "call-1",
      { question: "What should this be called?" },
      undefined,
      undefined,
      createContext({ editorAnswers: ["  clear name  "] }),
    );

    expect(result.content[0]?.text).toBe("User answered: clear name");
    expect(result.details).toMatchObject({
      status: "answered",
      mode: "text",
      answers: [{ type: "text", label: "clear name", value: "clear name" }],
    });
  });

  test("returns the selected option and its machine-readable value", async () => {
    const result = await registerQuestionTool().execute(
      "call-2",
      {
        question: "Choose a color",
        options: [
          { label: "Red", value: "red" },
          { label: "Blue", value: "blue" },
        ],
      },
      undefined,
      undefined,
      createContext({ selections: ["2. Blue"] }),
    );

    expect(result.details.answers).toEqual([
      { type: "option", label: "Blue", value: "blue", index: 2 },
    ]);
  });

  test("collects and sorts multiple selected options", async () => {
    const result = await registerQuestionTool().execute(
      "call-3",
      {
        question: "Choose colors",
        options: [
          { label: "Red", value: "red" },
          { label: "Blue", value: "blue" },
        ],
        multiSelect: true,
      },
      undefined,
      undefined,
      createContext({
        selections: ["[ ] 2. Blue", "[ ] 1. Red", "Submit (2 selected)"],
      }),
    );

    expect(result.details.answers).toEqual([
      { type: "option", label: "Red", value: "red", index: 1 },
      { type: "option", label: "Blue", value: "blue", index: 2 },
    ]);
  });

  test("reports when no interactive UI is available", async () => {
    const result = await registerQuestionTool().execute(
      "call-4",
      { question: "Can you answer?" },
      undefined,
      undefined,
      createContext({ hasUI: false }),
    );

    expect(result.details.status).toBe("unavailable");
  });
});
