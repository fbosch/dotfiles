import { randomUUID } from "node:crypto";
import {
  BorderedLoader,
  convertToLlm,
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
  buildHandoffDraft,
  buildSelectedFileContext,
  findHandoffState,
  HANDOFF_STATE_TYPE,
  type HandoffPayload,
  type HandoffState,
  parseHandoffPayload,
  readSourceSession,
  sourceReference,
} from "./context";

const MAX_GOAL_BYTES = 4 * 1024;

const HANDOFF_SYSTEM_PROMPT = `You are creating a handoff message for another coding agent with no access to this conversation.

Extract only what matters for continuing the work. Preserve concrete progress, decisions, constraints, user preferences, unresolved work, relevant validation, and exact file paths already established in the conversation. Exclude back-and-forth, dead ends, hidden reasoning, and handoff mechanics. Do not investigate or call tools.

Select project-relative files the next session should load, including likely edit targets, dependencies, tests, configuration, and key references. Prefer 8-15 files when that many are genuinely relevant. Never return more than 20. Do not return absolute paths.

Return one JSON object and no surrounding prose:
{"prompt":"self-contained Markdown continuation context and goal","files":["relative/path"]}`;

const ReadSessionParameters = {
  "~kind": "Object" as const,
  type: "object" as const,
  required: ["sessionID"] as const,
  properties: {
    sessionID: {
      "~kind": "String" as const,
      type: "string" as const,
      minLength: 1,
      description: "The full source Pi session ID shown in the handoff prompt.",
    },
    limit: {
      "~kind": "Number" as const,
      type: "number" as const,
      minimum: 1,
      maximum: 500,
      description: "Maximum user and assistant messages to return. Defaults to 100.",
    },
  },
};

interface GenerationOutcome {
  status: "success" | "cancelled" | "error";
  payload?: HandoffPayload;
}

export type HandoffGenerator = (
  ctx: ExtensionCommandContext,
  goal: string,
) => Promise<HandoffPayload | undefined>;

function entryToMessage(entry: SessionEntry) {
  if (entry.type === "message") return entry.message;
  if (entry.type !== "compaction") return undefined;
  return {
    role: "compactionSummary" as const,
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
    timestamp: new Date(entry.timestamp).getTime(),
  };
}

function conversationText(ctx: ExtensionCommandContext): string {
  const messages = ctx.sessionManager
    .buildContextEntries()
    .map(entryToMessage)
    .filter((message) => message !== undefined);
  if (messages.length === 0) throw new Error("No conversation to hand off.");
  return serializeConversation(convertToLlm(messages));
}

async function generatePayload(
  ctx: ExtensionCommandContext,
  goal: string,
  signal: AbortSignal,
): Promise<HandoffPayload> {
  const model = ctx.model;
  if (model === undefined) throw new Error("No model selected.");

  const direction =
    goal.length > 0 ? goal : "Continue the current conversation in its natural direction.";
  const response = await ctx.modelRegistry.complete(
    model,
    {
      systemPrompt: HANDOFF_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `## Conversation History\n\n${conversationText(ctx)}\n\n## Next-session direction\n\n${direction}`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    { signal, cacheRetention: "none", sessionId: randomUUID() },
  );
  if (response.stopReason !== "stop") throw new Error("Handoff generation did not complete.");

  const text = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return parseHandoffPayload(text);
}

const generateWithLoader: HandoffGenerator = async (ctx, goal) => {
  const outcome = await ctx.ui.custom<GenerationOutcome>((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
    let settled = false;
    const finish = (result: GenerationOutcome) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    loader.onAbort = () => finish({ status: "cancelled" });
    void generatePayload(ctx, goal, loader.signal)
      .then((payload) => finish({ status: "success", payload }))
      .catch(() => finish({ status: "error" }));
    return loader;
  });

  if (outcome.status === "cancelled") {
    ctx.ui.notify("Handoff cancelled.", "info");
    return undefined;
  }
  if (outcome.status === "error" || outcome.payload === undefined) {
    ctx.ui.notify("Could not generate a valid handoff prompt.", "error");
    return undefined;
  }
  return outcome.payload;
};

function goalByteLength(goal: string): number {
  return Buffer.byteLength(goal, "utf8");
}

async function executeHandoff(
  args: string,
  ctx: ExtensionCommandContext,
  generate: HandoffGenerator,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("handoff requires interactive mode", "error");
    return;
  }
  if (ctx.model === undefined) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const sourceSessionFile = ctx.sessionManager.getSessionFile();
  const sourceLeafId = ctx.sessionManager.getLeafId();
  if (sourceSessionFile === undefined || sourceLeafId === null) {
    ctx.ui.notify("No persisted conversation to hand off", "error");
    return;
  }

  const goal = args.trim();
  if (goalByteLength(goal) > MAX_GOAL_BYTES) {
    ctx.ui.notify("Handoff goal is too large", "error");
    return;
  }

  await ctx.waitForIdle();
  const payload = await generate(ctx, goal);
  if (payload === undefined) return;

  const sourceSessionId = ctx.sessionManager.getSessionId();
  const state: HandoffState = {
    version: 1,
    sourceSessionId,
    sourceLeafId,
    files: payload.files,
    consumed: false,
  };
  const draft = buildHandoffDraft(payload, sourceSessionId);
  const result = await ctx.newSession({
    parentSession: sourceSessionFile,
    setup: async (sessionManager) => {
      sessionManager.appendCustomEntry(HANDOFF_STATE_TYPE, state);
    },
    withSession: async (replacementCtx) => {
      replacementCtx.ui.setEditorText(draft);
      replacementCtx.ui.notify("Handoff ready. Review and submit the draft.", "info");
    },
  });
  if (result.cancelled) ctx.ui.notify("New session cancelled", "info");
}

export function createHandoffExtension(
  dependencies: { generate?: HandoffGenerator } = {},
): (pi: ExtensionAPI) => void {
  const generate = dependencies.generate ?? generateWithLoader;

  return (pi) => {
    let handoffInProgress = false;

    pi.registerCommand("handoff", {
      description: "Create a focused handoff prompt for a new session",
      handler: async (args, ctx) => {
        if (handoffInProgress) {
          ctx.ui.notify("A handoff is already in progress", "warning");
          return;
        }
        handoffInProgress = true;
        try {
          await executeHandoff(args, ctx, generate);
        } finally {
          handoffInProgress = false;
        }
      },
    });

    pi.registerTool(
      defineTool<typeof ReadSessionParameters, { code: string }>({
        name: "read_session",
        label: "Read Session",
        description:
          "Read a bounded transcript from this handoff's immediate source session. The requested session ID must match the source named in the handoff prompt.",
        promptSnippet: "Read exact details from the source session of the current handoff",
        parameters: ReadSessionParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const result = await readSourceSession(ctx, params.sessionID, params.limit ?? 100);
          return {
            content: [{ type: "text", text: result.text }],
            details: { code: result.code },
          };
        },
      }),
    );

    pi.on("before_agent_start", async (event, ctx) => {
      const handoff = findHandoffState(ctx.sessionManager.getEntries());
      if (handoff === undefined || handoff.consumed) return;

      pi.appendEntry(HANDOFF_STATE_TYPE, { ...handoff, consumed: true });
      if (event.prompt.includes(sourceReference(handoff.sourceSessionId)) === false) return;

      const content = await buildSelectedFileContext(ctx.cwd, handoff.files, event.prompt);
      if (content === undefined) return;
      return {
        message: {
          customType: "handoff-files",
          content,
          display: false,
          details: { sourceSessionId: handoff.sourceSessionId },
        },
      };
    });
  };
}

export default createHandoffExtension();
