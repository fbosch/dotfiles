import { describe, expect, test } from "bun:test";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import codeModeExtension from "../index";

const hostAvailable = Bun.which("codex-code-mode-host") !== null;
const integrationTest = hostAvailable ? test : test.skip;
const readSource = {
  path: "<builtin:read>",
  source: "builtin",
  scope: "temporary" as const,
  origin: "top-level" as const,
};

function createHarness() {
  let execTool: ToolDefinition | undefined;
  const calls: Array<{
    name: string;
    input: unknown;
    options: {
      parentToolCallId: string;
      signal?: AbortSignal;
      expectedSourceInfo?: typeof readSource;
    };
  }> = [];

  const pi = {
    registerTool(tool: ToolDefinition) {
      if (tool.name === "exec") execTool = tool;
    },
    getActiveTools: () => ["read", "write", "exec"],
    getAllTools: () => [
      {
        name: "read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        sourceInfo: readSource,
      },
      {
        name: "write",
        description: "Write a file",
        parameters: { type: "object" },
        sourceInfo: {
          path: "<builtin:write>",
          source: "builtin",
          scope: "temporary",
          origin: "top-level",
        },
      },
    ],
    async invokeTool(name: string, input: unknown, options: (typeof calls)[number]["options"]) {
      calls.push({ name, input, options });
      return {
        toolCallId: "nested-call",
        toolName: name,
        result: {
          content: [{ type: "text", text: `contents:${(input as { path: string }).path}` }],
          details: {},
        } satisfies AgentToolResult<unknown>,
        isError: false,
      };
    },
  } as unknown as ExtensionAPI;

  codeModeExtension(pi);
  const registeredExecTool = execTool;
  if (!registeredExecTool) throw new Error("exec tool was not registered");

  return {
    calls,
    async execute(code: string) {
      return registeredExecTool.execute(
        "parent-call",
        { code },
        AbortSignal.timeout(5_000),
        undefined,
        {} as ExtensionContext,
      );
    },
  };
}

describe("Code Mode extension", () => {
  integrationTest("routes allowlisted calls through nested dispatch", async () => {
    const harness = createHarness();

    const result = await harness.execute(`
      const value = await tools.read({ path: "README.md" });
      text(value.toUpperCase());
    `);

    expect(result.content).toEqual([{ type: "text", text: "CONTENTS:README.MD" }]);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({
      name: "read",
      input: { path: "README.md" },
      options: {
        parentToolCallId: "parent-call",
        expectedSourceInfo: readSource,
      },
    });
  });

  integrationTest("does not expose active mutating tools", async () => {
    const harness = createHarness();

    await expect(
      harness.execute(`await tools.write({ path: "blocked", content: "blocked" });`),
    ).rejects.toThrow();
    expect(harness.calls).toEqual([]);
  });
});
