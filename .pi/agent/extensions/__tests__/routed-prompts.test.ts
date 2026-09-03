import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  createRoutedPromptsExtension,
  parseCommandArgs,
  resolveRoutedPrompt,
  substitutePromptArgs,
} from "../routed-prompts";

type InputHandler = (
  event: InputEvent,
  ctx: ExtensionContext,
) => InputEventResult | Promise<InputEventResult | undefined> | undefined;

const promptCommand: SlashCommandInfo = {
  name: "decision",
  description: "Create an architecture decision",
  source: "prompt",
  sourceInfo: {
    path: "/prompts/decision.md",
    source: "local",
    scope: "user",
    origin: "top-level",
  },
};

function createHarness(options: {
  content: string;
  service?: {
    spawn(type: string, prompt: string, spawnOptions?: object): string;
  };
}) {
  let inputHandler: InputHandler | undefined;
  const messages: Array<{ customType: string; content: string; display: boolean }> = [];
  const notifications: Array<[string, string]> = [];
  const pi = {
    getCommands: () => [promptCommand],
    on(name: string, handler: InputHandler) {
      if (name === "input") inputHandler = handler;
    },
    registerMessageRenderer: () => undefined,
    sendMessage(message: { customType: string; content: string; display: boolean }) {
      messages.push(message);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push([message, level]);
      },
    },
  } as unknown as ExtensionContext;

  createRoutedPromptsExtension({
    getSubagentsService: () => options.service,
    readPrompt: () => options.content,
  })(pi);

  return {
    messages,
    notifications,
    async input(
      text: string,
      images?: InputEvent["images"],
      source: InputEvent["source"] = "interactive",
    ) {
      if (inputHandler === undefined) throw new Error("Input handler was not registered");
      return inputHandler(
        {
          type: "input",
          text,
          source,
          ...(images === undefined ? {} : { images }),
        },
        ctx,
      );
    },
  };
}

describe("routed prompts", () => {
  test("uses Pi-compatible argument parsing and substitution", () => {
    const args = parseCommandArgs(`one "two words" 'three words'`);

    expect(args).toEqual(["one", "two words", "three words"]);
    expect(parseCommandArgs(`"" one\\ two "unterminated`)).toEqual([
      "one\\",
      "two",
      "unterminated",
    ]);
    const template = [
      "$1",
      "$2",
      "$ARGUMENTS",
      "$" + "{4:-fallback}",
      "$" + "{@:2}",
      "$" + "{@:2:1}",
    ].join("|");
    expect(substitutePromptArgs(template, args)).toBe(
      "one|two words|one two words three words|fallback|two words three words|two words",
    );
  });

  test("resolves agent routing metadata from a loaded prompt", () => {
    const slicePlaceholder = "$" + "{@:2}";
    const content = `---
agent: general
model: openai-codex/gpt-5.6-terra
thinking: medium
max_turns: 8
inherit_context: true
usage: "Usage: /decision <topic>"
---
Topic: $1
All: $ARGUMENTS
Tail: ${slicePlaceholder}
`;

    expect(
      resolveRoutedPrompt(`/decision "use postgres" accepted`, [promptCommand], () => content),
    ).toEqual({
      agent: "general",
      command: "decision",
      description: "Create an architecture decision",
      prompt: "Topic: use postgres\nAll: use postgres accepted\nTail: accepted",
      options: {
        description: "Create an architecture decision",
        foreground: false,
        model: "openai-codex/gpt-5.6-terra",
        thinkingLevel: "medium",
        maxTurns: 8,
        inheritContext: true,
      },
    });
  });

  test("leaves ordinary and extension-injected prompts on Pi's native path", async () => {
    const ordinary = createHarness({
      content: "---\ndescription: Ordinary prompt\n---\nHandle $ARGUMENTS",
    });
    expect(await ordinary.input("/decision topic")).toEqual({ action: "continue" });

    let spawnCount = 0;
    const injected = createHarness({
      content: "---\nagent: general\n---\nHandle $ARGUMENTS",
      service: {
        spawn() {
          spawnCount += 1;
          return "agent-1";
        },
      },
    });
    expect(await injected.input("/decision topic", undefined, "extension")).toEqual({
      action: "continue",
    });
    expect(spawnCount).toBe(0);
  });

  test("dispatches a routed prompt through the named subagent", async () => {
    const spawns: unknown[][] = [];
    const harness = createHarness({
      content: "---\nagent: docs\ninherit_context: true\n---\nWrite $ARGUMENTS",
      service: {
        spawn(...args) {
          spawns.push(args);
          return "agent-1";
        },
      },
    });

    expect(await harness.input("/decision concise ADR")).toEqual({ action: "handled" });
    expect(spawns).toEqual([
      [
        "docs",
        "Write concise ADR",
        {
          description: "Create an architecture decision",
          foreground: false,
          inheritContext: true,
        },
      ],
    ]);
  });

  test("returns configured usage without starting a subagent", async () => {
    let spawnCount = 0;
    const harness = createHarness({
      content:
        '---\nagent: general\nusage: "Usage: /decision <short decision statement>"\n---\nTopic: $ARGUMENTS',
      service: {
        spawn() {
          spawnCount += 1;
          return "agent-1";
        },
      },
    });

    expect(await harness.input("/decision")).toEqual({ action: "handled" });
    expect(spawnCount).toBe(0);
    expect(harness.messages).toEqual([
      {
        customType: "routed-prompt",
        content: "Usage: /decision <short decision statement>",
        display: true,
      },
    ]);
  });

  test("fails loudly when routing is unavailable or would discard images", async () => {
    const unavailable = createHarness({
      content: "---\nagent: general\n---\nTopic: $ARGUMENTS",
    });
    expect(await unavailable.input("/decision topic")).toEqual({ action: "handled" });
    expect(unavailable.notifications).toEqual([
      ["Cannot run /decision: the pi-subagents service is unavailable.", "error"],
    ]);

    let spawnCount = 0;
    const withImage = createHarness({
      content: "---\nagent: general\n---\nTopic: $ARGUMENTS",
      service: {
        spawn() {
          spawnCount += 1;
          return "agent-1";
        },
      },
    });
    expect(
      await withImage.input("/decision topic", [
        {
          type: "image",
          data: "base64",
          mimeType: "image/png",
        },
      ]),
    ).toEqual({ action: "handled" });
    expect(spawnCount).toBe(0);
    expect(withImage.notifications).toEqual([
      ["Cannot run /decision: routed prompts do not support images.", "error"],
    ]);
  });
});
