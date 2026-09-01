import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { createFormatterExtension } from "../index";
import type { ResolvedFormatterSettings } from "../settings";

type SessionStartHandler = (event: never, context: ExtensionContext) => Promise<void> | void;
type ToolResultHandler = (
  event: ToolResultEvent,
  context: ExtensionContext,
) => Promise<unknown> | unknown;

test("serializes formatter runs for concurrent mutations to the same file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-extension-"));
  try {
    const filePath = join(directory, "example.ts");
    await writeFile(filePath, "const value=1");
    const settings: ResolvedFormatterSettings = {
      timeoutMs: 1_000,
      warnings: [],
      rules: [
        {
          id: "typescript",
          mode: "pipeline",
          extensions: [".ts"],
          fileNames: [],
          commands: [
            {
              command: "formatter",
              args: ["$FILE"],
              requireRootMarker: false,
              rootMarkers: [],
            },
          ],
        },
      ],
    };
    let sessionStart: SessionStartHandler | undefined;
    let toolResult: ToolResultHandler | undefined;
    let activeExecutions = 0;
    let maximumActiveExecutions = 0;
    let releaseFirstExecution: (() => void) | undefined;
    const firstExecution = new Promise<void>((resolve) => {
      releaseFirstExecution = resolve;
    });
    let markExecutionStarted: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    let executionCount = 0;
    const pi = {
      on(event: string, handler: SessionStartHandler | ToolResultHandler) {
        if (event === "session_start") sessionStart = handler as SessionStartHandler;
        if (event === "tool_result") toolResult = handler as ToolResultHandler;
      },
      async exec() {
        executionCount += 1;
        markExecutionStarted?.();
        activeExecutions += 1;
        maximumActiveExecutions = Math.max(maximumActiveExecutions, activeExecutions);
        if (executionCount === 1) await firstExecution;
        activeExecutions -= 1;
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    } as unknown as ExtensionAPI;
    const context = {
      cwd: directory,
      isProjectTrusted: () => true,
      signal: undefined,
      ui: { notify() {} },
    } as unknown as ExtensionContext;
    const event = (toolCallId: string): ToolResultEvent =>
      ({
        type: "tool_result",
        toolCallId,
        toolName: "write",
        input: { path: filePath, content: "const value=1" },
        content: [{ type: "text", text: "wrote file" }],
        details: undefined,
        isError: false,
      }) as ToolResultEvent;

    createFormatterExtension({
      commandAvailable: async () => true,
      readSettings: () => settings,
    })(pi);
    if (sessionStart === undefined || toolResult === undefined) {
      throw new Error("formatter handlers were not registered");
    }
    await sessionStart({} as never, context);

    const first = toolResult(event("first"), context);
    const second = toolResult(event("second"), context);
    await executionStarted;
    expect(executionCount).toBe(1);

    releaseFirstExecution?.();
    await Promise.all([first, second]);
    expect(executionCount).toBe(2);
    expect(maximumActiveExecutions).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
