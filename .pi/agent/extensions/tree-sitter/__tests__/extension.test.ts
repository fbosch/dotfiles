import { afterEach, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import treeSitterExtension from "../index";
import * as grammar from "../src/grammar";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-tree-sitter-extension-"));
  temporaryDirectories.push(path);
  return path;
}

type ToolCallHandler = (
  event: ToolCallEvent,
  context: ExtensionContext,
) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined;

function createHarness(cwd = "/project") {
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
    cwd,
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

test.each(["example.ts", "example.lua", "example.toml", "example.clj"])(
  "blocks writes when the grammar for %s is unavailable",
  async (path) => {
    const harness = createHarness();
    await treeSitterExtension(harness.pi);
    const load = spyOn(grammar, "loadGrammar").mockResolvedValue(null);
    try {
      expect(
        await harness.getToolCallHandler()(writeCall("", path), harness.context),
      ).toMatchObject({
        block: true,
        reason: expect.stringContaining("syntax validation is unavailable"),
      });
    } finally {
      load.mockRestore();
    }
  },
);

test("blocks edits when their grammar is unavailable", async () => {
  const root = await temporaryProject();
  await writeFile(join(root, "example.lua"), "local value = 1\n");
  const harness = createHarness(root);
  await treeSitterExtension(harness.pi);
  const load = spyOn(grammar, "loadGrammar").mockResolvedValue(null);
  try {
    expect(
      await harness.getToolCallHandler()(
        {
          type: "tool_call",
          toolCallId: "edit-unavailable",
          toolName: "edit",
          input: { path: "example.lua", edits: [{ oldText: "1", newText: "2" }] },
        },
        harness.context,
      ),
    ).toMatchObject({
      block: true,
      reason: expect.stringContaining("syntax validation is unavailable"),
    });
  } finally {
    load.mockRestore();
  }
});

test("structural tools report unavailable grammars instead of empty results", async () => {
  const root = await temporaryProject();
  await writeFile(join(root, "example.lua"), "function target() end\ntarget()\n");
  const harness = createHarness(root);
  await treeSitterExtension(harness.pi);
  const load = spyOn(grammar, "loadGrammar").mockResolvedValue(null);
  try {
    for (const name of [
      "list_symbols",
      "find_definition",
      "find_callers",
      "get_symbol_body",
      "find_callees",
    ]) {
      const tool = harness.tools.get(name);
      if (tool === undefined) throw new Error(`${name} was not registered`);
      const path = name === "find_callers" || name === "find_definition" ? root : "example.lua";
      await assert.rejects(
        async () =>
          tool.execute(
            "unavailable",
            { path, name: "target" },
            undefined,
            undefined,
            harness.context,
          ),
        /tree-sitter grammar is unavailable/,
      );
    }
  } finally {
    load.mockRestore();
  }
});

test("find_callers reports module-level, recursive, and nested call sites once each", async () => {
  const root = await temporaryProject();
  const file = join(root, "example.ts");
  await writeFile(
    file,
    [
      "function target() {",
      "  target();",
      "}",
      "target();",
      "function wrapper() {",
      "  const nested = () => target();",
      "  target();",
      "}",
      'const text = "target()";',
      "// target()",
    ].join("\n"),
  );
  const harness = createHarness(root);
  await treeSitterExtension(harness.pi);
  const tool = harness.tools.get("find_callers");
  if (tool === undefined) throw new Error("find_callers was not registered");

  const result = await tool.execute(
    "call-sites",
    { name: "target" },
    undefined,
    undefined,
    harness.context,
  );
  expect(result.details).toMatchObject({ count: 4 });
  const output = result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n");
  for (const line of [2, 4, 6, 7]) expect(output).toContain(`${file}:${line} `);
}, 120_000);

test("find_callers matches Lua qualified names exactly and bare member names broadly", async () => {
  const root = await temporaryProject();
  await writeFile(
    join(root, "example.lua"),
    [
      "function M.target()",
      "  M.target()",
      "end",
      "M.target()",
      "Other.target()",
      "object:method()",
      "-- M.target()",
      'local text = "object:method()"',
    ].join("\n"),
  );
  const harness = createHarness(root);
  await treeSitterExtension(harness.pi);
  const tool = harness.tools.get("find_callers");
  if (tool === undefined) throw new Error("find_callers was not registered");

  for (const [name, count] of [
    ["M.target", 2],
    ["target", 3],
    ["object:method", 1],
    ["method", 1],
    ["missing", 0],
  ] as const) {
    const result = await tool.execute(
      "lua-call-sites",
      { name },
      undefined,
      undefined,
      harness.context,
    );
    expect(result.details).toMatchObject({ count, name });
  }
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
