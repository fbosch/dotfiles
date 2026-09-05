import { expect, test } from "bun:test";
import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEditTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
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

test("does not overwrite a native edit made while a formatter is running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-native-edit-"));
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const pending: Promise<unknown>[] = [];
  try {
    const filePath = join(directory, "example.ts");
    await writeFile(filePath, "const a=1;\nconst b=1;\n");
    let sessionStart: SessionStartHandler | undefined;
    let toolResult: ToolResultHandler | undefined;
    const pi = {
      on(event: string, handler: SessionStartHandler | ToolResultHandler) {
        if (event === "session_start") sessionStart = handler as SessionStartHandler;
        if (event === "tool_result") toolResult = handler as ToolResultHandler;
      },
    } as unknown as ExtensionAPI;
    const context = { cwd: directory, ui: { notify() {} } } as unknown as ExtensionContext;
    createFormatterExtension({
      readSettings: () => ({
        timeoutMs: 1_000,
        warnings: [],
        rules: [{ id: "ts", mode: "pipeline", extensions: [".ts"], fileNames: [], commands: [] }],
      }),
      loadRuntime: async () => ({
        execute: async () => ({ kind: "success" }),
        formatFile: async () => {
          const snapshot = await readFile(filePath, "utf8");
          started.resolve();
          await release.promise;
          await writeFile(filePath, snapshot.replaceAll("=", " = "));
          return [];
        },
      }),
    })(pi);
    if (sessionStart === undefined || toolResult === undefined) {
      throw new Error("formatter handlers were not registered");
    }
    await sessionStart({} as never, context);
    const edit = createEditTool(directory);
    const input = { path: filePath, edits: [{ oldText: "a=1", newText: "a=2" }] };
    const result = await edit.execute("first", input);
    const formatting = Promise.resolve(
      toolResult(
        {
          type: "tool_result",
          toolCallId: "first",
          toolName: "edit",
          input,
          ...result,
          isError: false,
        },
        context,
      ),
    );
    pending.push(formatting);
    await started.promise;
    const secondEdit = edit.execute("second", {
      path: filePath,
      edits: [{ oldText: "b", newText: "c" }],
    });
    pending.push(secondEdit);
    // Give an unqueued native edit time to finish before the formatter writes its old snapshot.
    const completedEarly = await Promise.race([
      secondEdit.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    release.resolve();
    await Promise.all(pending);
    expect(completedEarly).toBe(false);
    expect(await readFile(filePath, "utf8")).toBe("const a = 2;\nconst c = 1;\n");
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await rm(directory, { recursive: true, force: true });
  }
});

test("loads the formatter runtime once for successful matching mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-lazy-runtime-"));
  try {
    const firstFile = join(directory, "first.ts");
    const secondFile = join(directory, "second.ts");
    const unmatchedFile = join(directory, "notes.txt");
    await Promise.all([
      writeFile(firstFile, "const first=1"),
      writeFile(secondFile, "const second=2"),
      writeFile(unmatchedFile, "notes"),
    ]);
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
    const pi = {
      on(event: string, handler: SessionStartHandler | ToolResultHandler) {
        if (event === "session_start") sessionStart = handler as SessionStartHandler;
        if (event === "tool_result") toolResult = handler as ToolResultHandler;
      },
    } as unknown as ExtensionAPI;
    const formatted: string[] = [];
    let runtimeLoads = 0;
    let settingsLoads = 0;
    const context = {
      cwd: directory,
      isProjectTrusted: () => true,
      signal: undefined,
      ui: { notify() {} },
    } as unknown as ExtensionContext;
    const event = (path: string): ToolResultEvent =>
      ({
        type: "tool_result",
        toolCallId: path,
        toolName: "write",
        input: { path, content: "updated" },
        content: [{ type: "text", text: "wrote file" }],
        details: undefined,
        isError: false,
      }) as ToolResultEvent;

    createFormatterExtension({
      loadRuntime: async () => {
        runtimeLoads += 1;
        return {
          execute: async () => ({ kind: "success" as const }),
          formatFile: async ({ filePath }) => {
            formatted.push(filePath);
            return [];
          },
        };
      },
      readSettings: () => {
        settingsLoads += 1;
        return settings;
      },
    })(pi);
    if (sessionStart === undefined || toolResult === undefined) {
      throw new Error("formatter handlers were not registered");
    }

    await sessionStart({} as never, context);
    expect(settingsLoads).toBe(1);

    await toolResult(event(unmatchedFile), context);
    expect(runtimeLoads).toBe(0);

    await Promise.all([
      toolResult(event(firstFile), context),
      toolResult(event(secondFile), context),
    ]);
    expect(runtimeLoads).toBe(1);
    expect(formatted).toHaveLength(2);
    expect(formatted).toContain(firstFile);
    expect(formatted).toContain(secondFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
