import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  createRoutedPromptsExtension,
  expandRoutedPromptShell,
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
  launch?: NonNullable<Parameters<typeof createRoutedPromptsExtension>[0]>["launch"];
}) {
  let inputHandler: InputHandler | undefined;
  const messages: Array<{ customType: string; content: string; display: boolean }> = [];
  const messageOptions: Array<Parameters<ExtensionAPI["sendMessage"]>[1]> = [];
  const notifications: Array<[string, string]> = [];
  const pi = {
    getCommands: () => [promptCommand],
    on(name: string, handler: InputHandler) {
      if (name === "input") inputHandler = handler;
    },
    registerMessageRenderer: () => undefined,
    sendMessage(
      message: { customType: string; content: string; display: boolean },
      options?: Parameters<ExtensionAPI["sendMessage"]>[1],
    ) {
      messages.push(message);
      messageOptions.push(options);
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
    launch:
      options.launch ??
      (async () => {
        throw new Error("Minimal subagents launch handler is unavailable");
      }),
    readPrompt: () => options.content,
  })(pi);

  return {
    messages,
    messageOptions,
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
    const shellPlaceholder = "$" + "{@}";
    expect(substitutePromptArgs(`"${shellPlaceholder}"`, args)).toBe(`"${shellPlaceholder}"`);
  });

  test("expands routed shell substitutions with isolated arguments", async () => {
    const shellPlaceholder = "$" + "{@}";
    const routedPrompt = await expandRoutedPromptShell(
      {
        agent: "quick",
        command: "example",
        description: "Example",
        prompt: `value: !\`printf '%s' "${shellPlaceholder}"\``,
        options: { foreground: false },
      },
      ["two words"],
      process.cwd(),
    );

    expect(routedPrompt.prompt).toBe("value: two words");
  });

  test.each([
    [
      "timeout",
      "sleep 5 & wait",
      { timeoutMs: 100, maxOutputBytes: 1024 },
      "timed out after 100 ms",
    ],
    ["output", "yes", { timeoutMs: 5_000, maxOutputBytes: 1024 }, "output exceeded 1024 bytes"],
    [
      "stderr output",
      "yes >&2",
      { timeoutMs: 5_000, maxOutputBytes: 1024 },
      "output exceeded 1024 bytes",
    ],
  ] as const)(
    "stops routed shell substitutions that exceed the %s limit",
    async (_name, command, limits, message) => {
      const started = performance.now();
      await expect(
        expandRoutedPromptShell(
          {
            agent: "quick",
            command: "example",
            description: "Example",
            prompt: `value: !\`${command}\``,
            options: { foreground: false },
          },
          [],
          process.cwd(),
          limits,
        ),
      ).rejects.toThrow(message);
      expect(performance.now() - started).toBeLessThan(2_000);
    },
  );

  test("does not execute shell syntax injected through prompt arguments", async () => {
    const injected = "!`printf injected`";
    const content = `---
agent: general
---
Argument: $ARGUMENTS
Trusted: !\`printf '%s' trusted\``;
    const invocation = `/decision "${injected}"`;
    const routedPrompt = resolveRoutedPrompt(invocation, [promptCommand], () => content, true);
    if (routedPrompt === undefined) throw new Error("prompt did not resolve");

    const expanded = await expandRoutedPromptShell(
      routedPrompt,
      parseCommandArgs(`"${injected}"`),
      process.cwd(),
    );

    expect(expanded.prompt).toBe(`Argument: ${injected}\nTrusted: trusted`);
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
        foreground: false,
        model: "openai-codex/gpt-5.6-terra",
        thinking: "medium",
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
      launch: async () => {
        spawnCount += 1;
        return { kind: "launched" };
      },
    });
    expect(await injected.input("/decision topic", undefined, "extension")).toEqual({
      action: "continue",
    });
    expect(spawnCount).toBe(0);
  });

  test("dispatches a routed prompt through the named subagent", async () => {
    const spawns: object[] = [];
    const harness = createHarness({
      content: "---\nagent: docs\ninherit_context: true\n---\nWrite $ARGUMENTS",
      launch: async (request) => {
        spawns.push(request);
        return { kind: "launched" };
      },
    });

    expect(await harness.input("/decision concise ADR")).toEqual({ action: "handled" });
    expect(spawns).toEqual([
      { specialist: "docs", prompt: "Write concise ADR", foreground: false, inheritContext: true },
    ]);
  });

  test("/ado-pbi opts into returning its worker report", () => {
    const command = { ...promptCommand, name: "ado-pbi" };
    const template = readFileSync(new URL("../../prompts/ado-pbi.md", import.meta.url), "utf8");
    expect(resolveRoutedPrompt("/ado-pbi 62360", [command], () => template)?.returnReport).toBe(true);
  });

  test("returns the exact full report without starting a parent turn", async () => {
    const content = "# PBI #42: Tilpas beregner\n\n" + "Details\n".repeat(700) + "## Wiki Links\n- None\n";
    const requests: object[] = [];
    const harness = createHarness({
      content: "---\nagent: quick\nreturn_report: true\n---\nFormat $ARGUMENTS",
      launch: async (request) => {
        requests.push(request);
        return { kind: "completed", report: content };
      },
    });

    expect(await harness.input("/decision 42")).toEqual({ action: "handled" });
    expect(requests).toEqual([{
      specialist: "quick", prompt: "Format 42", foreground: true, triggerParentTurn: false,
    }]);
    expect(harness.messages).toEqual([{ customType: "routed-prompt.report", content, display: true }]);
    expect(harness.messageOptions).toEqual([{ triggerTurn: false }]);
    expect(harness.notifications).toEqual([]);
  });

  test("a direct route surfaces worker failure instead of publishing a report", async () => {
    const harness = createHarness({
      content: "---\nagent: quick\nreturn_report: true\n---\nFormat $ARGUMENTS",
      launch: async () => ({ kind: "failed", assignment: { error: "Worker could not start" } }),
    });
    expect(await harness.input("/decision 42")).toEqual({ action: "handled" });
    expect(harness.messages).toEqual([]);
    expect(harness.notifications).toEqual([["Cannot run /decision: Worker could not start", "error"]]);
  });
  test("returns configured usage without starting a subagent", async () => {
    let spawnCount = 0;
    const harness = createHarness({
      content:
        '---\nagent: general\nusage: "Usage: /decision <short decision statement>"\n---\nTopic: $ARGUMENTS',
      launch: async () => {
        spawnCount += 1;
        return { kind: "launched" };
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
      ["Cannot run /decision: Minimal subagents launch handler is unavailable", "error"],
    ]);

    let spawnCount = 0;
    const withImage = createHarness({
      content: "---\nagent: general\n---\nTopic: $ARGUMENTS",
      launch: async () => {
        spawnCount += 1;
        return { kind: "launched" };
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
