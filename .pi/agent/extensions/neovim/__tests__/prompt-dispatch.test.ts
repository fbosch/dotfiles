import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendPrompt, submitPrompt } from "../prompt-dispatch";

function fixture(
  options: {
    readonly blockingPromptActive?: boolean;
    readonly editorText?: string;
    readonly hasUI?: boolean;
    readonly idle?: boolean;
    readonly mode?: ExtensionContext["mode"];
  } = {},
) {
  let editorText = options.editorText ?? "";
  const sent: Array<{
    readonly options: { readonly expandPromptTemplates?: boolean } | undefined;
    readonly text: string;
  }> = [];
  const editorWrites: string[] = [];
  const pi = {
    sendUserMessage: (
      text: string,
      sendOptions: { readonly expandPromptTemplates?: boolean } | undefined,
    ) => {
      sent.push({ options: sendOptions, text });
    },
  } as unknown as ExtensionAPI;
  const context = {
    hasUI: options.hasUI ?? true,
    isIdle: () => options.idle ?? true,
    mode: options.mode ?? "tui",
    ui: {
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
        editorWrites.push(text);
      },
    },
  } as unknown as ExtensionContext;

  return {
    append: (text: string) => appendPrompt(context, text),
    editorText: () => editorText,
    editorWrites,
    sent,
    submit: (text: string) =>
      submitPrompt(pi, context, text, options.blockingPromptActive ?? false),
  };
}

describe("Pi prompt public API dispatch", () => {
  test("submits one literal idle message with expansion disabled", () => {
    const target = fixture();

    expect(target.submit("/review æøå 🚀")).toEqual({ ok: true });
    expect(target.sent).toEqual([
      {
        options: { expandPromptTemplates: false },
        text: "/review æøå 🚀",
      },
    ]);
  });

  test.each([
    { blockingPromptActive: true, idle: true },
    { blockingPromptActive: false, idle: false },
  ])("rejects busy state without submission", (options) => {
    const target = fixture(options);

    expect(target.submit("do not send")).toEqual({ code: "PI_BUSY", ok: false });
    expect(target.sent).toEqual([]);
  });

  test.each([
    { hasUI: false, mode: "tui" as const },
    { hasUI: true, mode: "rpc" as const },
  ])("rejects a missing TUI without submission", (options) => {
    const target = fixture(options);

    expect(target.submit("do not send")).toEqual({ code: "PI_NO_UI", ok: false });
    expect(target.sent).toEqual([]);
  });

  test("appends exact text without a user-message dispatch", () => {
    const target = fixture({ editorText: "existing" });

    expect(target.append("\n@this")).toEqual({ ok: true });
    expect(target.editorText()).toBe("existing\n@this");
    expect(target.editorWrites).toEqual(["existing\n@this"]);
    expect(target.sent).toEqual([]);
  });

  test("rejects append without a TUI editor", () => {
    const target = fixture({ mode: "rpc" });

    expect(target.append("ignored")).toEqual({ code: "PI_NO_UI", ok: false });
    expect(target.editorWrites).toEqual([]);
  });
});
