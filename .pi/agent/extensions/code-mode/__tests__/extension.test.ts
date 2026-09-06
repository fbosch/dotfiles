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

function createHarness(harnessOptions?: { approveRead?: boolean; nestedError?: boolean }) {
  let execTool: ToolDefinition | undefined;
  const calls: Array<{
    name: string;
    input: unknown;
    options: {
      parentToolCallId: string;
      signal?: AbortSignal;
      expectedSourceInfo?: typeof readSource;
      expectedRegistrationId?: string;
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
        ...(harnessOptions?.approveRead === false ? {} : { programmatic: "read-only" }),
        registrationId: "read-v1",
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
          content: [
            {
              type: "text",
              text: harnessOptions?.nestedError
                ? "denied"
                : `contents:${(input as { path: string }).path}`,
            },
          ],
          details: {},
          ...(harnessOptions?.nestedError ? { terminate: true } : {}),
        } satisfies AgentToolResult<unknown>,
        isError: harnessOptions?.nestedError === true,
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
        expectedRegistrationId: "read-v1",
      },
    });
  });

  integrationTest("rejects tools without explicit read-only exposure", async () => {
    const harness = createHarness({ approveRead: false });

    await expect(harness.execute('text("blocked")')).rejects.toThrow("no active read-only tools");
    expect(harness.calls).toEqual([]);
  });

  integrationTest("preserves termination when sandbox code catches a denial", async () => {
    const harness = createHarness({ nestedError: true });

    const result = await harness.execute(`
      try { await tools.read({ path: "denied" }); } catch {}
      text("continued");
    `);

    expect(result.content).toEqual([{ type: "text", text: "continued" }]);
    expect(result.terminate).toBe(true);
  });

  integrationTest("preserves error status for an uncaught terminating denial", async () => {
    const harness = createHarness({ nestedError: true });

    try {
      await harness.execute('await tools.read({ path: "denied" });');
      throw new Error("expected Code Mode to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("AgentToolError");
      expect((error as Error & { result: AgentToolResult<unknown> }).result.terminate).toBe(true);
    }
  });

  integrationTest("bounds aggregate image output", async () => {
    const harness = createHarness();
    const pixel = `data:image/png;base64,${Buffer.from("fixture-png").toString("base64")}`;

    await expect(
      harness.execute(`for (let index = 0; index < 5; index++) image("${pixel}");`),
    ).rejects.toThrow("exceeds 4 images");
  });

  integrationTest("does not expose active mutating tools", async () => {
    const harness = createHarness();

    await expect(
      harness.execute(`await tools.write({ path: "blocked", content: "blocked" });`),
    ).rejects.toThrow();
    expect(harness.calls).toEqual([]);
  });
});
