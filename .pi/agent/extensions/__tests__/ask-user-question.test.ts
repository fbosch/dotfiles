import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
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
  inputAnswers?: Array<string | undefined>;
  hasUI?: boolean;
}): ExtensionContext {
  const selections = [...(options.selections ?? [])];
  const inputAnswers = [...(options.inputAnswers ?? [])];

  return {
    hasUI: options.hasUI ?? true,
    ui: {
      input: async () => inputAnswers.shift(),
      notify: () => undefined,
      select: async () => selections.shift(),
    },
  } as unknown as ExtensionContext;
}

function createInlineContext(
  interact: (component: Component, rendered: string[]) => void,
): ExtensionContext {
  return {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async (
        factory: (
          tui: { requestRender(): void },
          theme: { fg(color: string, text: string): string },
          keybindings: object,
          done: (value: unknown) => void,
        ) => Component,
        options: { overlay?: boolean },
      ) => {
        expect(options).toEqual({ overlay: false });
        return new Promise((resolve) => {
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text },
            {},
            resolve,
          );
          interact(component, component.render(80));
        });
      },
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
      createContext({ inputAnswers: ["  clear name  "] }),
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

  test("renders single-select questions as an inline permission-style prompt", async () => {
    const result = await registerQuestionTool().execute(
      "call-inline-1",
      {
        question: "Choose a color",
        details: "This controls the accent.",
        options: [
          { label: "Red", value: "red" },
          { label: "Blue", value: "blue", description: "Cooler" },
        ],
      },
      undefined,
      undefined,
      createInlineContext((component, rendered) => {
        expect(rendered).toContain("Choose a color");
        expect(rendered).toContain("This controls the accent.");
        expect(rendered).toContain("▶ 1. Red");
        expect(rendered).toContain("↑/↓ move · enter select · esc cancel");
        component.handleInput?.("j");
        component.handleInput?.("\r");
      }),
    );

    expect(result.details.answers).toEqual([
      { type: "option", label: "Blue", value: "blue", index: 2 },
    ]);
  });

  test("collects free-form input from the inline prompt", async () => {
    const result = await registerQuestionTool().execute(
      "call-inline-text",
      { question: "What should this be called?" },
      undefined,
      undefined,
      createInlineContext((component, rendered) => {
        expect(rendered).toContain("Answer:");
        expect(rendered).toContain("enter submit · esc cancel");
        for (const character of "clear name") component.handleInput?.(character);
        component.handleInput?.("\r");
      }),
    );

    expect(result.details.answers).toEqual([
      { type: "text", label: "clear name", value: "clear name" },
    ]);
  });

  test("toggles and submits multiple choices from the inline prompt", async () => {
    const result = await registerQuestionTool().execute(
      "call-inline-2",
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
      createInlineContext((component) => {
        component.handleInput?.("\r");
        component.handleInput?.("j");
        component.handleInput?.("\r");
        component.handleInput?.("j");
        component.handleInput?.("j");
        component.handleInput?.("\r");
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

  test("cancels an active free-form prompt", async () => {
    const controller = new AbortController();
    let markPromptStarted: () => void = () => {};
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve;
    });
    const context = {
      hasUI: true,
      ui: {
        input: async (_title: string, _placeholder: string, options: { signal?: AbortSignal }) => {
          markPromptStarted();
          return new Promise<string | undefined>((resolve) => {
            options.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
          });
        },
      },
    } as unknown as ExtensionContext;
    const resultPromise = registerQuestionTool().execute(
      "call-5",
      { question: "Can you answer?" },
      controller.signal,
      undefined,
      context,
    );

    await promptStarted;
    controller.abort();

    expect((await resultPromise).details.status).toBe("cancelled");
  });

  test("cancels while waiting for another question without opening a second prompt", async () => {
    let finishFirstPrompt: ((answer: string) => void) | undefined;
    let promptCount = 0;
    let markFirstPromptStarted: () => void = () => {};
    const firstPromptStarted = new Promise<void>((resolve) => {
      markFirstPromptStarted = resolve;
    });
    const context = {
      hasUI: true,
      ui: {
        input: async () => {
          promptCount += 1;
          markFirstPromptStarted();
          return new Promise<string>((resolve) => {
            finishFirstPrompt = resolve;
          });
        },
      },
    } as unknown as ExtensionContext;
    const tool = registerQuestionTool();
    const firstResult = tool.execute(
      "call-6",
      { question: "First question" },
      undefined,
      undefined,
      context,
    );
    await firstPromptStarted;

    const controller = new AbortController();
    const secondResult = tool.execute(
      "call-7",
      { question: "Second question" },
      controller.signal,
      undefined,
      context,
    );
    controller.abort();

    expect((await secondResult).details.status).toBe("cancelled");
    expect(promptCount).toBe(1);

    if (finishFirstPrompt === undefined) throw new Error("First prompt did not open");
    finishFirstPrompt("answer");
    expect((await firstResult).details.status).toBe("answered");
    expect(promptCount).toBe(1);
  });
});
