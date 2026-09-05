import { expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import treeSitterExtension from "../index";

type ToolCallHandler = (
  event: ToolCallEvent,
  context: ExtensionContext,
) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined;

function createHarness() {
  const tools = new Map<string, ToolDefinition>();
  let toolCallHandler: ToolCallHandler | undefined;
  const pi = {
    on(event: string, handler: ToolCallHandler) {
      if (event === "tool_call") toolCallHandler = handler;
    },
    registerTool(definition: ToolDefinition) {
      tools.set(definition.name, definition);
    },
  } as unknown as ExtensionAPI;

  const context = {
    cwd: "/project",
    ui: { notify() {} },
  } as unknown as ExtensionContext;

  return {
    context,
    pi,
    tools,
    getToolCallHandler(): ToolCallHandler {
      if (toolCallHandler === undefined) throw new Error("tool_call handler was not registered");
      return toolCallHandler;
    },
  };
}

function writeCall(content: string, path = "example.el"): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "write-1",
    toolName: "write",
    input: { path, content },
  };
}

test("registers structural tools and blocks malformed delimiter-only files", async () => {
  const harness = createHarness();
  await treeSitterExtension(harness.pi);

  expect([...harness.tools.keys()]).toEqual([
    "list_symbols",
    "find_definition",
    "find_callers",
    "get_symbol_body",
    "find_callees",
  ]);

  const handler = harness.getToolCallHandler();
  expect(await handler(writeCall("(defun example ()\n  (+ 1 2)"), harness.context)).toMatchObject({
    block: true,
    reason: expect.stringContaining("file was NOT modified"),
  });
  expect(
    await handler(writeCall("(defun example ()\n  (+ 1 2))"), harness.context),
  ).toBeUndefined();
});

test("allows valid Lua writes and blocks missing end tokens", async () => {
  const harness = createHarness();
  await treeSitterExtension(harness.pi);
  const handler = harness.getToolCallHandler();

  expect(
    await handler(
      writeCall("local function greet()\n  return 1\nend", "example.lua"),
      harness.context,
    ),
  ).toBeUndefined();
  expect(
    await handler(writeCall("local function greet()\n  return 1", "example.lua"), harness.context),
  ).toMatchObject({
    block: true,
    reason: expect.stringContaining("Missing `end`"),
  });
}, 120_000);

test("structural tools reject an already-cancelled call", async () => {
  const harness = createHarness();
  await treeSitterExtension(harness.pi);
  const listSymbols = harness.tools.get("list_symbols");
  if (listSymbols === undefined) throw new Error("list_symbols was not registered");

  const signal = AbortSignal.abort();
  expect(
    listSymbols.execute("cancelled", { path: "example.ts" }, signal, undefined, harness.context),
  ).rejects.toMatchObject({ name: "AbortError" });
});
