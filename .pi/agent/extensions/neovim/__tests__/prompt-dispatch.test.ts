import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendPrompt, submitPrompt } from "../prompt-dispatch";

function fixture(
  options: {
    readonly blockingPromptActive?: boolean;
    readonly editorText?: string;
    readonly hasUI?: boolean;
    readonly idle?: boolean;
    readonly streaming?: boolean;
    readonly mode?: ExtensionContext["mode"];
    readonly sendThrows?: boolean;
    readonly writeThrows?: boolean;
  } = {},
) {
  let editorText = options.editorText ?? "";
  const sent: Array<{
    readonly options:
      | {
          readonly deliverAs?: "steer";
          readonly expandPromptTemplates?: boolean;
        }
      | undefined;
    readonly text: string;
  }> = [];
  const editorWrites: string[] = [];
  const pi = {
    sendUserMessage: (
      text: string,
      sendOptions:
        | {
            readonly deliverAs?: "steer";
            readonly expandPromptTemplates?: boolean;
          }
        | undefined,
    ) => {
      sent.push({ options: sendOptions, text });
      if (options.sendThrows === true) throw new Error("send failed");
    },
  } as unknown as ExtensionAPI;
  const context = {
    hasUI: options.hasUI ?? true,
    isIdle: () => options.idle ?? true,
    signal: options.streaming === true ? new AbortController().signal : undefined,
    mode: options.mode ?? "tui",
    ui: {
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
        editorWrites.push(text);
        if (options.writeThrows === true) throw new Error("write failed");
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

  test("rejects a blocking UI prompt without submission", () => {
    const target = fixture({ blockingPromptActive: true });

    expect(target.submit("do not send")).toEqual({ code: "PI_BUSY", ok: false });
    expect(target.sent).toEqual([]);
  });

  test("queues a streaming literal message as steering", () => {
    const target = fixture({ idle: false, streaming: true });

    expect(target.submit("queue this")).toEqual({ ok: true });
    expect(target.sent).toEqual([
      {
        options: { deliverAs: "steer", expandPromptTemplates: false },
        text: "queue this",
      },
    ]);
  });

  test("rejects a non-streaming busy state without submission", () => {
    const target = fixture({ idle: false });

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

  test.each([
    { operation: "submit" as const, options: { sendThrows: true } },
    { operation: "append" as const, options: { writeThrows: true } },
  ])("reports uncertain delivery after a public API throws", ({ operation, options }) => {
    const target = fixture(options);

    expect(target[operation]("possibly delivered")).toEqual({
      code: "PI_DELIVERY_UNKNOWN",
      ok: false,
    });
  });

  test("rejects append without a TUI editor", () => {
    const target = fixture({ mode: "rpc" });

    expect(target.append("ignored")).toEqual({ code: "PI_NO_UI", ok: false });
    expect(target.editorWrites).toEqual([]);
  });
});
