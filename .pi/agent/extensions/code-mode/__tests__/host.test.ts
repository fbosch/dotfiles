import { describe, expect, test } from "bun:test";
import { type CodeModeTool, executeCodeMode } from "../host";

const hostAvailable = Bun.which("codex-code-mode-host") !== null;
const readTool: CodeModeTool = {
  name: "read",
  description: "Read a file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  sourceInfo: {
    path: "<builtin:read>",
    source: "builtin",
    scope: "temporary",
    origin: "top-level",
  },
};

const integrationTest = hostAvailable ? test : test.skip;

describe("Code Mode host", () => {
  integrationTest("emits only explicit output from the restricted runtime", async () => {
    const result = await executeCodeMode({
      source: `
        const hidden = await tools.read({ path: "hidden" });
        text([hidden, typeof process, typeof require, typeof fetch, typeof console].join("|"));
      `,
      toolCallId: "code-mode-test",
      tools: [readTool],
      signal: AbortSignal.timeout(5_000),
      invokeTool: async () => ({ value: "selected output" }),
    });

    expect(result.contentItems).toEqual([
      {
        type: "input_text",
        text: "selected output|undefined|undefined|undefined|undefined",
      },
    ]);
    expect(result.nestedToolCalls).toBe(1);
  });

  integrationTest("serializes nested calls made through Promise.all", async () => {
    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];

    const result = await executeCodeMode({
      source: `
        const values = await Promise.all([
          tools.read({ path: "a" }),
          tools.read({ path: "b" }),
        ]);
        text(values.join("|"));
      `,
      toolCallId: "code-mode-test",
      tools: [readTool],
      signal: AbortSignal.timeout(5_000),
      async invokeTool(_tool, input) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const path = (input as { path: string }).path;
        calls.push(path);
        await Bun.sleep(20);
        active -= 1;
        return { value: path.toUpperCase() };
      },
    });

    expect(calls).toEqual(["a", "b"]);
    expect(maxActive).toBe(1);
    expect(result.contentItems).toEqual([{ type: "input_text", text: "A|B" }]);
  });

  integrationTest("stops an infinite script when cancelled", async () => {
    const started = performance.now();

    await expect(
      executeCodeMode({
        source: "while (true) {}",
        toolCallId: "code-mode-test",
        tools: [],
        signal: AbortSignal.timeout(100),
        invokeTool: async () => ({ value: "unused" }),
      }),
    ).rejects.toThrow();

    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
