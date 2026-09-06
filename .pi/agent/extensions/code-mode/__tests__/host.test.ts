import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  registrationId: "read-v1",
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

  integrationTest("bounds aggregate output items", async () => {
    await expect(
      executeCodeMode({
        source: 'for (let index = 0; index < 129; index++) text("x");',
        toolCallId: "code-mode-test",
        tools: [],
        signal: AbortSignal.timeout(5_000),
        invokeTool: async () => ({ value: "unused" }),
      }),
    ).rejects.toThrow("exceeds 128 items");
  });

  integrationTest("cancels while an unawaited nested call remains unsettled", async () => {
    const started = performance.now();

    await expect(
      executeCodeMode({
        source: 'tools.read({ path: "stalled" }); text("done");',
        toolCallId: "code-mode-test",
        tools: [readTool],
        signal: AbortSignal.timeout(150),
        invokeTool: async () => new Promise(() => undefined),
      }),
    ).rejects.toThrow();

    expect(performance.now() - started).toBeLessThan(2_000);
  });

  integrationTest("rejects delegates before protocol negotiation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-code-mode-peer-"));
    const peer = join(directory, "peer");
    const script = `#!/usr/bin/env bun
const send = (value) => {
  const payload = Buffer.from(JSON.stringify(value));
  const frame = Buffer.alloc(payload.length + 4);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  process.stdout.write(frame);
};
process.stdin.once("data", () => {
  send({ type: "delegate/request", id: 1, request: { type: "tool/invoke", invocation: { tool_name: { name: "read" }, input: {} } } });
  send({ type: "connection/rejected", reason: "incompatible" });
});
`;
    await writeFile(peer, script);
    await chmod(peer, 0o700);
    let invocations = 0;

    try {
      await expect(
        executeCodeMode({
          source: 'text("never")',
          toolCallId: "code-mode-test",
          tools: [readTool],
          signal: AbortSignal.timeout(5_000),
          hostCommand: peer,
          invokeTool: async () => {
            invocations += 1;
            return { value: "unexpected" };
          },
        }),
      ).rejects.toThrow("did not negotiate");
      expect(invocations).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
