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
  const toolNames: string[] = [];
  let toolCallHandler: ToolCallHandler | undefined;
  const pi = {
    on(event: string, handler: ToolCallHandler) {
      if (event === "tool_call") toolCallHandler = handler;
    },
    registerTool(definition: ToolDefinition) {
      toolNames.push(definition.name);
    },
  } as unknown as ExtensionAPI;

  const context = {
    cwd: "/project",
    ui: { notify() {} },
  } as unknown as ExtensionContext;

  return {
    context,
    pi,
    toolNames,
    getToolCallHandler(): ToolCallHandler {
      if (toolCallHandler === undefined) throw new Error("tool_call handler was not registered");
      return toolCallHandler;
    },
  };
}

function writeCall(content: string): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "write-1",
    toolName: "write",
    input: { path: "example.el", content },
  };
}

test("registers structural tools and blocks malformed delimiter-only files", async () => {
  const harness = createHarness();
  await treeSitterExtension(harness.pi);

  expect(harness.toolNames).toEqual([
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
