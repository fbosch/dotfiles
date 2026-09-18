import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  formatTranscript,
  HANDOFF_STATE_TYPE,
  type HandoffState,
  parseHandoffPayload,
  serializeHandoffHistory,
  sourceReference,
} from "../context";
import { createHandoffExtension, generationFailureReason } from "../index";

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

function handoffState(
  source: SessionManager,
  files: string[] = [],
  draft = buildHandoffDraft({ prompt: "Continue.", files }, source.getSessionId()),
): HandoffState {
  const sourceLeafId = source.getLeafId();
  if (sourceLeafId === null) throw new Error("source session has no leaf");
  return {
    version: 1,
    sourceSessionId: source.getSessionId(),
    sourceLeafId,
    files,
    draft,
    consumed: false,
  };
}

test("parses bounded model output and rejects malformed file lists", () => {
  const payload = parseHandoffPayload(`\`\`\`json
{"prompt":"Continue the work.","files":["src/main.ts"]}
\`\`\``);

  expect(payload).toEqual({ prompt: "Continue the work.", files: ["src/main.ts"] });
  expect(() =>
    parseHandoffPayload(
      '{"prompt":"Continue.","files":["../secret","/etc/passwd","C:secret","\\\\server\\share"]}',
    ),
  ).toThrow();
  expect(() => parseHandoffPayload('{"prompt":"Continue.","files":"src/main.ts"}')).toThrow();
});

test("reports bounded generation failures without multiline output", () => {
  expect(generationFailureReason(new Error("invalid\nmodel response"))).toBe(
    "invalid model response",
  );
  expect(generationFailureReason(new Error("x".repeat(500)))).toHaveLength(240);
  expect(generationFailureReason("failure")).toBe("Unknown generation error.");
});

test("handoff history excludes thinking, tool arguments, and tool results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-history-"));
  const source = SessionManager.create(directory, join(directory, "sessions"));
  source.appendMessage({ role: "user", content: "Visible request", timestamp: Date.now() });
  source.appendMessage({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "THINKING_SECRET" },
      { type: "text", text: "Visible answer" },
      {
        type: "toolCall",
        id: "call-secret",
        name: "read",
        arguments: { token: "ARGUMENT_SECRET" },
      },
    ],
    api: "openai-responses",
    provider: "openai-codex",
    model: "test-model",
    usage,
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  source.appendMessage({
    role: "toolResult",
    toolCallId: "call-secret",
    toolName: "read",
    content: [{ type: "text", text: "TOOL_RESULT_SECRET" }],
    isError: false,
    timestamp: Date.now(),
  });

  try {
    const history = serializeHandoffHistory(source.buildContextEntries());
    expect(history).toContain("Visible request");
    expect(history).toContain("Visible answer");
    expect(history).toContain("[Tool: read]");
    expect(history).not.toContain("THINKING_SECRET");
    expect(history).not.toContain("ARGUMENT_SECRET");
    expect(history).not.toContain("TOOL_RESULT_SECRET");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("formats large transcripts within the output budget", () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({
    type: "message" as const,
    id: `message-${index}`,
    parentId: index === 0 ? null : `message-${index - 1}`,
    timestamp: new Date(index).toISOString(),
    message: {
      role: "user" as const,
      content: `${index}:${"x".repeat(60 * 1024)}`,
      timestamp: index,
    },
  }));

  const transcript = formatTranscript(entries, 500);
  expect(Buffer.byteLength(transcript, "utf8")).toBeLessThanOrEqual(256 * 1024);
  expect(transcript).toContain("499:");
  expect(transcript).not.toContain("0:");
  expect(transcript).toContain("truncated");
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
  let generatedEntryCount = 0;
  const pi = {
    registerCommand: (_name: string, options: { handler: CommandHandler }) => {
      command = options.handler;
    },
    registerTool: () => {},
    on: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  createHandoffExtension({
    generate: async (_ctx, goal, entries) => {
      receivedGoal = goal;
      generatedEntryCount = entries.length;
      return { prompt: "Continue the implementation.", files: ["src/main.ts"] };
    },
  })(pi);

  const context = {
    mode: "tui",
    model: { id: "test-model" },
    sessionManager: source,
    waitForIdle: async () => {
      source.appendMessage({ role: "user", content: "Settled update", timestamp: Date.now() });
    },
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
    expect(generatedEntryCount).toBe(source.buildContextEntries().length);
    expect(target?.getHeader()?.parentSession).toBe(sourceFile);
    const draft = buildHandoffDraft(
      { prompt: "Continue the implementation.", files: ["src/main.ts"] },
      source.getSessionId(),
    );
    expect(target === undefined ? undefined : findHandoffState(target.getEntries())).toEqual(
      handoffState(source, ["src/main.ts"], draft),
    );
    expect(editorText).toBe(draft);
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
    const unrelated = await beforeAgentStart?.({ prompt: "Unrelated prompt" }, context);
    expect(unrelated).toBeUndefined();
    expect(findHandoffState(target.getEntries())?.consumed).toBeFalse();

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
  const sourceBefore = (await readFile(sourceFile, "utf8")).replace(/\n$/u, "");
  await writeFile(sourceFile, sourceBefore);

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
    expect(await readFile(sourceFile, "utf8")).toBe(sourceBefore);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("restores an unconsumed draft on resume without submitting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-handoff-resume-"));
  const sessionDirectory = join(directory, "sessions");
  await mkdir(sessionDirectory);
  const source = SessionManager.create(directory, sessionDirectory);
  appendConversation(source);
  const sourceFile = source.getSessionFile();
  if (sourceFile === undefined) throw new Error("source session is not persisted");
  const target = SessionManager.create(directory, sessionDirectory, { parentSession: sourceFile });
  const state = handoffState(source, ["notes.txt"]);
  target.appendCustomEntry(HANDOFF_STATE_TYPE, state);

  let sessionStart: ((event: { reason: string }, ctx: ExtensionContext) => void) | undefined;
  let editorText = "";
  let sentMessages = 0;
  const pi = {
    registerCommand: () => {},
    registerTool: () => {},
    on: (event: string, handler: (event: { reason: string }, ctx: ExtensionContext) => void) => {
      if (event === "session_start") sessionStart = handler;
    },
    appendEntry: () => {},
    sendUserMessage: () => {
      sentMessages += 1;
    },
  } as unknown as ExtensionAPI;
  createHandoffExtension()(pi);
  const context = {
    sessionManager: target,
    ui: {
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
    },
  } as unknown as ExtensionContext;

  try {
    sessionStart?.({ reason: "resume" }, context);
    expect(editorText).toBe(state.draft);
    expect(sentMessages).toBe(0);

    editorText = "Edited draft";
    sessionStart?.({ reason: "reload" }, context);
    expect(editorText).toBe("Edited draft");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
