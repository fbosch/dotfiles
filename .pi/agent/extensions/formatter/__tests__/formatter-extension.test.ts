import { expect, test } from "bun:test";
import { link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("serializes formatter runs through filesystem aliases of the same file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-extension-"));
  try {
    const filePath = join(directory, "example.ts");
    const aliasPath = join(directory, "alias.ts");
    const hardLinkPath = join(directory, "hard-link.ts");
    await writeFile(filePath, "const value=1");
    await symlink(filePath, aliasPath);
    await link(filePath, hardLinkPath);
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
    } as unknown as ExtensionAPI;
    const execute = async () => {
      executionCount += 1;
      markExecutionStarted?.();
      activeExecutions += 1;
      maximumActiveExecutions = Math.max(maximumActiveExecutions, activeExecutions);
      if (executionCount === 1) await firstExecution;
      activeExecutions -= 1;
      return { kind: "success" } as const;
    };
    const context = {
      cwd: directory,
      isProjectTrusted: () => true,
      signal: undefined,
      ui: { notify() {} },
    } as unknown as ExtensionContext;
    const event = (toolCallId: string, path: string): ToolResultEvent =>
      ({
        type: "tool_result",
        toolCallId,
        toolName: "write",
        input: { path, content: "const value=1" },
        content: [{ type: "text", text: "wrote file" }],
        details: undefined,
        isError: false,
      }) as ToolResultEvent;

    createFormatterExtension({
      commandAvailable: async () => true,
      execute,
      readSettings: () => settings,
    })(pi);
    if (sessionStart === undefined || toolResult === undefined) {
      throw new Error("formatter handlers were not registered");
    }
    await sessionStart({} as never, context);

    const first = toolResult(event("first", filePath), context);
    const second = toolResult(event("second", aliasPath), context);
    const third = toolResult(event("third", hardLinkPath), context);
    await executionStarted;
    expect(executionCount).toBe(1);

    releaseFirstExecution?.();
    await Promise.all([first, second, third]);
    expect(executionCount).toBe(3);
    expect(maximumActiveExecutions).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
