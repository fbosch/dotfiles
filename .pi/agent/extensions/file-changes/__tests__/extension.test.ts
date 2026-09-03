import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { createFileChangesExtension } from "../index";

type EventHandler = (event: never, context: ExtensionContext) => unknown;
type CommandHandler = (args: string, context: ExtensionCommandContext) => Promise<void> | void;
type WidgetFactory = (tui: TUI, theme: never) => Component;
type WidgetContent = string[] | WidgetFactory | undefined;

interface SessionEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function createHarness(initialFiles: Record<string, string | null>) {
  const cwd = "/repo";
  const files = new Map(
    Object.entries(initialFiles).map(([path, content]) => [join(cwd, path), content]),
  );
  const entries: SessionEntry[] = [];
  const handlers = new Map<string, EventHandler>();
  const statuses: Array<string | undefined> = [];
  const widgets: WidgetContent[] = [];
  const notifications: string[] = [];
  let command: CommandHandler | undefined;

  const pi = {
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      if (name === "changes") command = options.handler;
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd,
    hasUI: true,
    mode: "tui",
    sessionManager: { getBranch: () => entries },
    ui: {
      getToolsExpanded: () => false,
      notify: (message: string) => notifications.push(message),
      setStatus: (_key: string, value: string | undefined) => statuses.push(value),
      setWidget: (_key: string, content: WidgetContent, _options?: ExtensionWidgetOptions) =>
        widgets.push(content),
    },
  } as unknown as ExtensionCommandContext;

  createFileChangesExtension({
    readTextFile: async (absolutePath) => files.get(absolutePath),
  })(pi);

  async function emit(event: string, value: object): Promise<void> {
    await handlers.get(event)?.(value as never, context);
  }

  return {
    context,
    entries,
    files,
    notifications,
    statuses,
    widgets,
    emit,
    async runCommand(args: string): Promise<void> {
      if (command === undefined) throw new Error("changes command was not registered");
      await command(args, context);
    },
  };
}

function writeCall(toolCallId: string, path: string) {
  return {
    type: "tool_call",
    toolCallId,
    toolName: "write",
    input: { path, content: "after\n" },
  };
}

function writeResult(toolCallId: string, path: string, isError = false) {
  return {
    type: "tool_result",
    toolCallId,
    toolName: "write",
    input: { path, content: "after\n" },
    content: [{ type: "text", text: "wrote file" }],
    details: undefined,
    isError,
  };
}

describe("file changes extension", () => {
  test("tracks successful writes and restores their first baseline", async () => {
    const harness = createHarness({ "example.ts": "before\n" });
    await harness.emit("session_start", { reason: "startup" });

    await harness.emit("tool_call", writeCall("write-1", "example.ts"));
    harness.files.set("/repo/example.ts", "after\n");
    await harness.emit("tool_result", writeResult("write-1", "example.ts"));

    expect(harness.statuses.at(-1)).toBe("1 file +1 -1");
    expect(harness.widgets.at(-1)).toBeTypeOf("function");
    expect(harness.entries).toContainEqual({
      type: "custom",
      customType: "file-changes:baseline",
      data: {
        path: "example.ts",
        originalContent: "before\n",
        timestamp: expect.any(Number),
      },
    });

    harness.statuses.length = 0;
    await harness.emit("session_start", { reason: "reload" });
    expect(harness.statuses.at(-1)).toBe("1 file +1 -1");
  });

  test("ignores failed writes and untracks files restored to baseline", async () => {
    const harness = createHarness({ "example.ts": "before\n" });
    await harness.emit("session_start", { reason: "startup" });

    await harness.emit("tool_call", writeCall("failed", "example.ts"));
    await harness.emit("tool_result", writeResult("failed", "example.ts", true));
    expect(harness.entries).toEqual([]);

    await harness.emit("tool_call", writeCall("changed", "example.ts"));
    harness.files.set("/repo/example.ts", "after\n");
    await harness.emit("tool_result", writeResult("changed", "example.ts"));
    await harness.emit("tool_call", writeCall("restored", "example.ts"));
    harness.files.set("/repo/example.ts", "before\n");
    await harness.emit("tool_result", writeResult("restored", "example.ts"));

    expect(harness.statuses.at(-1)).toBeUndefined();
    expect(harness.widgets.at(-1)).toBeUndefined();
    expect(harness.entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "file-changes:untrack",
      data: { path: "example.ts" },
    });
  });

  test("supports explicit visibility and clearing commands", async () => {
    const harness = createHarness({ "example.ts": null });
    await harness.emit("tool_call", writeCall("new", "example.ts"));
    harness.files.set("/repo/example.ts", "after\n");
    await harness.emit("tool_result", writeResult("new", "example.ts"));

    await harness.runCommand("hide");
    expect(harness.widgets.at(-1)).toBeUndefined();
    expect(harness.notifications.at(-1)).toBe("Changes hidden");

    await harness.runCommand("show");
    expect(harness.widgets.at(-1)).toBeTypeOf("function");

    await harness.runCommand("clear");
    expect(harness.statuses.at(-1)).toBeUndefined();
    expect(harness.entries.at(-1)).toMatchObject({ customType: "file-changes:clear" });
    expect(harness.notifications.at(-1)).toBe("Cleared 1 file");
  });
});
