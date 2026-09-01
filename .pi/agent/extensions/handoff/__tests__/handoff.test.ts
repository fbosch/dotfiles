import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  buildHandoffDraft,
  findHandoffState,
  HANDOFF_STATE_TYPE,
  type HandoffState,
  parseHandoffPayload,
  sourceReference,
} from "../context";
import { createHandoffExtension } from "../index";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type BeforeAgentStartHandler = (
  event: { prompt: string },
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;
type CapturedTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: { sessionID: string; limit?: number },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: { code: string };
  }>;
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function appendConversation(manager: SessionManager): void {
  manager.appendMessage({ role: "user", content: "Original request", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [
      { type: "text", text: "Implemented the first part." },
      { type: "toolCall", id: "call-1", name: "read", arguments: {} },
    ],
    api: "openai-responses",
    provider: "openai-codex",
    model: "test-model",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function handoffState(source: SessionManager, files: string[] = []): HandoffState {
  const sourceLeafId = source.getLeafId();
  if (sourceLeafId === null) throw new Error("source session has no leaf");
  return {
    version: 1,
    sourceSessionId: source.getSessionId(),
    sourceLeafId,
    files,
    consumed: false,
  };
}

test("parses bounded model output and rejects unsafe file paths", () => {
  const payload = parseHandoffPayload(`\`\`\`json
{"prompt":"Continue the work.","files":["src/main.ts","src/main.ts","../secret","/etc/passwd","C:\\\\secret"]}
\`\`\``);

  expect(payload).toEqual({ prompt: "Continue the work.", files: ["src/main.ts"] });
});

test("creates a parent-linked session with an editable unsubmitted draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-command-"));
  const sessionDirectory = join(directory, "sessions");
  await mkdir(sessionDirectory);
  const source = SessionManager.create(directory, sessionDirectory);
  appendConversation(source);
  const sourceFile = source.getSessionFile();
  if (sourceFile === undefined) throw new Error("source session is not persisted");

  let command: CommandHandler | undefined;
  let editorText = "";
  let sentMessages = 0;
  let target: SessionManager | undefined;
  let receivedGoal: string | undefined;
  const pi = {
    registerCommand: (_name: string, options: { handler: CommandHandler }) => {
      command = options.handler;
    },
    registerTool: () => {},
    on: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  createHandoffExtension({
    generate: async (_ctx, goal) => {
      receivedGoal = goal;
      return { prompt: "Continue the implementation.", files: ["src/main.ts"] };
    },
  })(pi);

  const context = {
    mode: "tui",
    model: { id: "test-model" },
    sessionManager: source,
    waitForIdle: async () => {},
    ui: { notify: () => {} },
    newSession: async (options: {
      parentSession?: string;
      setup?: (sessionManager: SessionManager) => Promise<void>;
      withSession?: (ctx: ExtensionCommandContext) => Promise<void>;
    }) => {
      if (options.parentSession === undefined) throw new Error("missing parent session");
      target = SessionManager.create(directory, sessionDirectory, {
        parentSession: options.parentSession,
      });
      await options.setup?.(target);
      await options.withSession?.({
        ui: {
          setEditorText: (text: string) => {
            editorText = text;
          },
          notify: () => {},
        },
        sendUserMessage: () => {
          sentMessages += 1;
        },
      } as unknown as ExtensionCommandContext);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext;

  try {
    await command?.("", context);

    expect(receivedGoal).toBe("");
    expect(target?.getHeader()?.parentSession).toBe(sourceFile);
    expect(target === undefined ? undefined : findHandoffState(target.getEntries())).toEqual(
      handoffState(source, ["src/main.ts"]),
    );
    expect(editorText).toBe(
      buildHandoffDraft(
        { prompt: "Continue the implementation.", files: ["src/main.ts"] },
        source.getSessionId(),
      ),
    );
    expect(target?.getEntries().filter((entry) => entry.type === "message")).toHaveLength(0);
    expect(sentMessages).toBe(0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("injects retained selected files once when the draft is submitted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-files-"));
  const sessionDirectory = join(directory, "sessions");
  await mkdir(sessionDirectory);
  await writeFile(join(directory, "notes.txt"), "first line\nsecond line\n");
  const source = SessionManager.create(directory, sessionDirectory);
  appendConversation(source);
  const sourceFile = source.getSessionFile();
  if (sourceFile === undefined) throw new Error("source session is not persisted");
  const target = SessionManager.create(directory, sessionDirectory, { parentSession: sourceFile });
  const state = handoffState(source, ["notes.txt"]);
  target.appendCustomEntry(HANDOFF_STATE_TYPE, state);

  let beforeAgentStart: BeforeAgentStartHandler | undefined;
  const pi = {
    registerCommand: () => {},
    registerTool: () => {},
    on: (event: string, handler: BeforeAgentStartHandler) => {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
    appendEntry: (customType: string, data: unknown) => target.appendCustomEntry(customType, data),
  } as unknown as ExtensionAPI;
  createHandoffExtension()(pi);
  const context = { cwd: directory, sessionManager: target } as unknown as ExtensionContext;
  const prompt = `${sourceReference(source.getSessionId())}\n\n@notes.txt\n\nContinue.`;

  try {
    const first = (await beforeAgentStart?.({ prompt }, context)) as
      | { message?: { content: string; display: boolean } }
      | undefined;
    const second = await beforeAgentStart?.({ prompt }, context);

    expect(first?.message?.content).toContain("## notes.txt");
    expect(first?.message?.content).toContain("1: first line");
    expect(first?.message?.display).toBeFalse();
    expect(second).toBeUndefined();
    expect(findHandoffState(target.getEntries())?.consumed).toBeTrue();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("read_session is restricted to the pinned parent branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-read-session-"));
  const sessionDirectory = join(directory, "sessions");
  await mkdir(sessionDirectory);
  const source = SessionManager.create(directory, sessionDirectory);
  appendConversation(source);
  const sourceFile = source.getSessionFile();
  if (sourceFile === undefined) throw new Error("source session is not persisted");
  const target = SessionManager.create(directory, sessionDirectory, { parentSession: sourceFile });
  target.appendCustomEntry(HANDOFF_STATE_TYPE, handoffState(source));

  let tool: CapturedTool | undefined;
  const pi = {
    registerCommand: () => {},
    registerTool: (registered: unknown) => {
      tool = registered as CapturedTool;
    },
    on: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  createHandoffExtension()(pi);
  const context = { cwd: directory, sessionManager: target } as unknown as ExtensionContext;

  try {
    const success = await tool?.execute(
      "call-1",
      { sessionID: source.getSessionId() },
      undefined,
      undefined,
      context,
    );
    const mismatch = await tool?.execute(
      "call-2",
      { sessionID: "different-session" },
      undefined,
      undefined,
      context,
    );

    expect(success?.details.code).toBe("OK");
    expect(success?.content[0]?.text).toContain("## User\nOriginal request");
    expect(success?.content[0]?.text).toContain("[Tool: read]");
    expect(mismatch?.details.code).toBe("SOURCE_MISMATCH");
    expect(mismatch?.content[0]?.text).not.toContain(sourceFile);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
