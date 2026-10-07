import { describe, expect, test } from "bun:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
  SessionManager,
  type Skill,
  type TurnEndEvent,
  type TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { buildMidTaskPrompt, MAX_MID_TASK_PROMPT_CHARS, sanitizeClassifierText } from "../mid-task";
import {
  createSkillSelectionExtension,
  DEFAULT_SKILL_SELECTION_CONFIG,
  type SkillSelectionAttempt,
} from "../selection";

const registry = await createNativeClassifierRegistry();
const config = { ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: true };
const skills: Skill[] = ["gjs", "diagnosing-bugs", "writing-clearly"].map((name) => ({
  name,
  description: `${name} workflow`,
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  disableModelInvocation: false,
  sourceInfo: {} as Skill["sourceInfo"],
}));
const noMatch: SkillSelectionAttempt = {
  ok: true,
  value: { recommendations: [], scores: new Map(), noMatchScore: 1 },
};
const recommend = (name: string): SkillSelectionAttempt => ({
  ok: true,
  value: {
    recommendations: [{ name, score: 0.95 }],
    scores: new Map([[name, 0.95]]),
    noMatchScore: 0,
  },
});

function harness(
  select?: NonNullable<Parameters<typeof createSkillSelectionExtension>[0]>["selectSkillsDetailed"],
  sessionManager?: SessionManager,
) {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  const requests: { prompt: string; names: string[]; signal?: AbortSignal }[] = [];
  let notify: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
  const api = {
    events: createEventBus(),
    registerEntryRenderer: () => {},
    appendEntry: (type: string, data: unknown) => sessionManager?.appendCustomEntry(type, data),
    registerCommand: (name: string, definition: { handler: typeof notify }) => {
      if (name === "classifier-status") notify = definition.handler;
    },
    on: (name: string, handler: (event: unknown, context: ExtensionContext) => unknown) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  const controller = new AbortController();
  const ctx = {
    cwd: "/tmp",
    signal: controller.signal,
    modelRegistry: registry,
    isProjectTrusted: () => true,
    sessionManager: sessionManager ?? {
      getBranch: () => [],
      buildSessionProjection: () => ({ entries: [], messages: [], thinkingLevel: "", model: null }),
    },
  } as unknown as ExtensionContext;
  createSkillSelectionExtension({
    getConfig: () => config,
    getDisabledNames: () => new Set(),
    selectSkillsDetailed: async (prompt, candidates, options, requestOptions) => {
      requests.push({
        prompt,
        names: candidates.map((skill) => skill.name),
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      });
      return select ? select(prompt, candidates, options, requestOptions) : noMatch;
    },
  })(api);
  const emit = async (kind: string, event: unknown) => {
    const handler = handlers.get(kind);
    if (!handler) throw new Error(`Missing handler: ${kind}`);
    return await handler(event, ctx);
  };
  const start = async (goal = "Fix the widget", options: Partial<BeforeAgentStartEvent> = {}) => {
    const event = {
      type: "before_agent_start",
      prompt: goal,
      systemPrompt: "instructions",
      systemPromptOptions: { sections: {}, skills },
      ...options,
    } as unknown as BeforeAgentStartEvent;
    sessionManager?.appendMessage({ role: "user", content: goal, timestamp: 1 });
    const result = (await emit("before_agent_start", event)) as
      | BeforeAgentStartEventResult
      | undefined;
    if (result?.message) {
      sessionManager?.appendMessage({ role: "custom", ...result.message, timestamp: 2 });
    }
    await emit("message_start", {
      type: "message_start",
      message: { role: "user", content: goal },
    });
    return event;
  };
  const tool = async (
    id: string,
    name = "read",
    args: unknown = {},
    result: unknown = {},
    isError = false,
    parentToolCallId?: string,
  ) => {
    const parent = parentToolCallId ? { parentToolCallId } : {};
    await emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: id,
      toolName: name,
      args,
      ...parent,
    });
    await emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: id,
      toolName: name,
      result,
      isError,
      ...parent,
    });
  };
  const turn = (
    text = "Investigate the signal lifecycle",
    id = "call",
    options: Partial<TurnEndEvent> = {},
  ): TurnEndEvent => ({
    type: "turn_end",
    turnIndex: 0,
    outcome: "completed",
    entries: [],
    continue: false,
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text },
        { type: "thinking", thinking: "HIDDEN THINKING SENTINEL" },
        { type: "toolCall", id, name: "read", arguments: { path: "/private/source.ts" } },
      ],
    } as AssistantMessage,
    toolResults: [
      {
        role: "toolResult",
        toolCallId: id,
        toolName: "read",
        isError: false,
        timestamp: 1,
        content: [{ type: "text", text: "RAW RESULT SENTINEL" }],
        details: { secret: "PRIVATE DETAIL SENTINEL" },
      } as ToolResultMessage,
    ],
    messageEntryId: "message",
    toolResultEntryIds: ["result"],
    context: {
      canContinue: true,
      pendingMessages: [],
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
    },
    ...options,
  });
  const end = async (event = turn()) =>
    (await emit("turn_end", event)) as TurnEndEventResult | undefined;
  const status = async () => {
    let json = "";
    if (!notify) throw new Error("Status command missing");
    await notify("", {
      ...ctx,
      ui: {
        notify: (message: string) => {
          json = message;
        },
      },
    } as unknown as ExtensionContext);
    return JSON.parse(json);
  };
  return { requests, emit, start, tool, turn, end, status, controller, ctx };
}

describe("turn-end skill suggestions", () => {
  test("sends bounded goal/visible activity/delta and allowlisted metadata, not tool bodies or thinking", async () => {
    const h = harness();
    await h.start("Fix refresh; password=secret123");
    await h.tool(
      "call",
      "read",
      { path: "/private/source.ts" },
      { content: [{ type: "text", text: "RAW RESULT SENTINEL" }] },
    );
    await h.end(h.turn("Investigate signals; Bearer abc123"));
    expect(h.requests).toHaveLength(2);
    const request = h.requests[1];
    expect(request).toBeDefined();
    const snapshot = JSON.parse(request?.prompt ?? "{}");
    expect(snapshot.userGoal).toBe("Fix refresh; [redacted]");
    expect(snapshot.latestVisibleAssistantText).toBe("Investigate signals; [redacted]");
    expect(snapshot.completedToolObservations).toEqual(["Completed read: ok"]);
    expect(snapshot.purpose).toContain("Require concrete evidence");
    expect(snapshot.purpose).toContain("not broad topic overlap or hypothetical usefulness");
    expect(snapshot.deltaSinceLastAttempt.visibleAssistantExcerpts).toEqual([
      "Investigate signals; [redacted]",
    ]);
    for (const excluded of [
      "secret123",
      "abc123",
      "HIDDEN THINKING",
      "RAW RESULT",
      "PRIVATE DETAIL",
      "/private/source.ts",
    ]) {
      expect(request?.prompt).not.toContain(excluded);
    }
    expect(request?.prompt.length ?? 0).toBeLessThanOrEqual(MAX_MID_TASK_PROMPT_CHARS);
  });

  test("deduplicates input and mid-task advice across later requests and reloads", async () => {
    const manager = SessionManager.inMemory("/tmp");
    let count = 0;
    const h = harness(
      async () => (++count === 1 ? recommend("gjs") : recommend("writing-clearly")),
      manager,
    );
    await h.start();
    await h.tool("call");
    const result = await h.end();
    expect(h.requests[1]?.names).not.toContain("gjs");
    for (const entry of result?.entries ?? []) {
      if (entry.type === "custom") manager.appendCustomEntry(entry.customType, entry.data);
      if (entry.type === "custom_message") {
        manager.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
        );
      }
    }
    const before = manager.buildSessionProjection().messages;
    const reloaded = harness(async () => recommend("writing-clearly"), manager);
    await reloaded.start("Continue tracing");
    expect(reloaded.requests[0]?.names).toEqual(["diagnosing-bugs"]);
    expect(manager.buildSessionProjection().messages.slice(0, before.length)).toEqual(before);
    expect(manager.getBranch().filter((entry) => entry.type === "context_edit")).toHaveLength(0);
  });

  test("skips mid-task classification when no complete advice record can fit", async () => {
    const manager = SessionManager.inMemory("/tmp");
    const h = harness(async () => noMatch, manager);
    await h.start();
    manager.appendCustomMessageEntry("skill-recommendation-advice", "x".repeat(5_950), false, {
      skills: [],
    });
    await h.tool("call");
    expect(await h.end()).toBeUndefined();
    expect(h.requests).toHaveLength(1);
    expect((await h.status()).midTask.reason).toBe("advisory-budget-exhausted");
  });

  test("adds fresh advice to next context, preserves previous drafts and never requests continuation", async () => {
    let count = 0;
    const h = harness(async () => (++count === 1 ? noMatch : recommend("gjs")));
    await h.start();
    await h.tool("call");
    const previous = {
      type: "custom" as const,
      customType: "other-extension",
      data: { keep: true },
    };
    const result = await h.end(h.turn(undefined, undefined, { entries: [previous] }));
    expect(result?.continue).toBeUndefined();
    expect(result?.entries?.[0]).toBe(previous);
    const advice = result?.entries?.find((entry) => entry.type === "custom_message");
    expect(advice?.type).toBe("custom_message");
    if (advice?.type !== "custom_message") throw new Error("No advice");
    expect(advice.content).toContain('name="gjs"');
    expect(advice.content).toContain("/skills/gjs/SKILL.md");
    expect(advice.display).toBe(false);
    expect(advice.content).toContain("advisory recommendations");
    expect(advice.customType).toBe("skill-recommendation-advice");
    await h.tool("call2");
    await h.end(h.turn("Now inspect refresh state", "call2"));
    expect(h.requests[2]?.names).not.toContain("gjs");
    expect((await h.status()).midTask.attempts).toBe(2);
  });

  test("excludes initial recommendations and actual successful nested/direct reads", async () => {
    let count = 0;
    const h = harness(async () => (++count === 1 ? recommend("diagnosing-bugs") : noMatch));
    await h.start();
    await h.tool("nested", "read", { path: "/skills/gjs/SKILL.md" }, {}, false, "call");
    await h.tool("call", "codemode");
    await h.end();
    expect(h.requests[1]?.names).toEqual(["writing-clearly"]);
    const state = JSON.parse(h.requests[1]?.prompt ?? "{}");
    expect(state.alreadyRead).toEqual(["gjs"]);
    expect(state.alreadyRecommended).toEqual(["diagnosing-bugs"]);
  });

  test.each(["isError", "structuredError"])(
    "does not mark unsuccessful reads as loaded: %s",
    async (failure) => {
      const h = harness();
      await h.start();
      await h.tool(
        "call",
        "read",
        { path: "/skills/gjs/SKILL.md" },
        failure === "structuredError" ? { structuredContent: { ok: false } } : {},
        failure === "isError",
      );
      await h.end();
      expect(h.requests[1]?.names).toContain("gjs");
    },
  );

  test("unchanged observations after no match consume no additional attempts; new activity carries goal and cumulative evidence", async () => {
    const h = harness();
    await h.start("Fix refresh");
    await h.tool("call");
    await h.end();
    await h.tool("call2");
    await h.end(h.turn(undefined, "call2"));
    expect(h.requests).toHaveLength(2);
    expect((await h.status()).midTask.reason).toBe("unchanged-evidence");
    await h.tool("call3", "bash");
    await h.end(h.turn("Check signal cleanup", "call3"));
    expect(h.requests).toHaveLength(3);
    const snapshot = JSON.parse(h.requests[2]?.prompt ?? "{}");
    expect(snapshot.userGoal).toBe("Fix refresh");
    expect(snapshot.visibleAssistantExcerpts).toEqual([
      "Investigate the signal lifecycle",
      "Check signal cleanup",
    ]);
    expect(snapshot.deltaSinceLastAttempt.visibleAssistantExcerpts).toEqual([
      "Check signal cleanup",
    ]);
    expect(snapshot.completedToolObservations).toEqual([
      "Completed read: ok",
      "Completed bash: ok",
    ]);
    expect(snapshot.deltaSinceLastAttempt.completedToolObservations).toEqual([
      "Completed bash: ok",
    ]);
  });

  test.each(["failure", "throw", "no-match"])(
    "caps attempts at two even on %s and resets for next user request",
    async (outcome) => {
      let count = 0;
      const h = harness(async () => {
        if (++count === 1 || outcome === "no-match") return noMatch;
        if (outcome === "throw") throw new Error("PRIVATE ERROR SENTINEL");
        return {
          ok: false,
          failure: { kind: "classifier-failure", stage: "request", reason: "request-failure" },
        };
      });
      await h.start();
      for (let i = 0; i < 3; i++) {
        await h.tool(`call${i}`);
        await h.end(h.turn(`Visible phase ${i}`, `call${i}`));
      }
      expect(h.requests).toHaveLength(3);
      expect((await h.status()).midTask).toMatchObject({ attempts: 2, reason: "attempt-budget" });
      await h.start("Fix another widget");
      await h.tool("next");
      await h.end(h.turn("Inspect another widget", "next"));
      expect((await h.status()).midTask.attempts).toBe(1);
      expect(JSON.stringify(await h.status())).not.toContain("PRIVATE ERROR");
    },
  );

  test.each(["stop", "error", "aborted", "length"] as const)(
    "skips %s responses and cannot force another turn",
    async (stopReason) => {
      const h = harness();
      await h.start();
      await h.tool("call");
      const message = { ...h.turn().message, stopReason } as AssistantMessage;
      expect(await h.end(h.turn(undefined, undefined, { message }))).toBeUndefined();
      expect(h.requests).toHaveLength(1);
    },
  );

  test.each(["terminate", "missing-metadata", "no-results", "cannot-continue", "queued-user"])(
    "skips non-natural continuation: %s",
    async (caseName) => {
      const h = harness();
      await h.start();
      if (caseName !== "missing-metadata")
        await h.tool("call", "read", {}, { terminate: caseName === "terminate" });
      const event = h.turn();
      if (caseName === "no-results") event.toolResults = [];
      if (caseName === "cannot-continue") event.context.canContinue = false;
      if (caseName === "queued-user")
        event.context.pendingMessages = [{ role: "user", content: "New task", timestamp: 1 }];
      expect(await h.end(event)).toBeUndefined();
      expect(h.requests).toHaveLength(1);
    },
  );

  test.each(["explicit", "image", "disabled", "restricted"])(
    "preserves startup exclusion: %s",
    async (caseName) => {
      const h = harness();
      const options: Partial<BeforeAgentStartEvent> = {};
      if (caseName === "image")
        options.images = [{ type: "image", data: "", mimeType: "image/png" }];
      if (caseName === "restricted")
        options.systemPromptOptions = {
          sections: {},
          skills: skills.map((skill) => ({ ...skill, disableModelInvocation: true })),
        } as BeforeAgentStartEvent["systemPromptOptions"];
      const wasEnabled = config.enabled;
      if (caseName === "disabled") config.enabled = false;
      try {
        await h.start(caseName === "explicit" ? "/skill:gjs" : "Fix widget", options);
      } finally {
        config.enabled = wasEnabled;
      }
      await h.tool("call");
      expect(await h.end()).toBeUndefined();
      expect(h.requests).toHaveLength(0);
    },
  );

  test.each(["session_start", "session_tree", "session_shutdown", "new-request"])(
    "discards stale classifier results on %s",
    async (kind) => {
      let calls = 0;
      let finish: ((value: SkillSelectionAttempt) => void) | undefined;
      const h = harness(async () =>
        ++calls === 2
          ? await new Promise((resolve) => {
              finish = resolve;
            })
          : noMatch,
      );
      await h.start();
      await h.tool("call");
      const pending = h.end();
      await Promise.resolve();
      const signal = h.requests[1]?.signal;
      if (kind === "new-request") await h.start("New goal");
      else await h.emit(kind, { type: kind });
      expect(signal?.aborted).toBe(true);
      if (!finish) throw new Error("Classifier not called");
      finish(recommend("gjs"));
      expect(await pending).toBeUndefined();
      expect((await h.status()).midTask.attempts).toBe(0);
    },
  );

  test("queued user messages establish a new goal/budget without before_agent_start", async () => {
    const h = harness();
    await h.start();
    await h.tool("call");
    await h.end();
    await h.emit("message_start", {
      type: "message_start",
      message: { role: "user", content: "Review the docs" },
    });
    await h.tool("next");
    await h.end(h.turn("Review the wording", "next"));
    expect(JSON.parse(h.requests[2]?.prompt ?? "{}").userGoal).toBe("Review the docs");
    expect((await h.status()).midTask.attempts).toBe(1);
  });

  test("successful direct reads exclude the loaded skill", async () => {
    const h = harness();
    await h.start();
    await h.tool("call", "read", { path: "/skills/gjs/SKILL.md" });
    await h.end();
    expect(h.requests[1]?.names).not.toContain("gjs");
  });

  test("late tool completions from an old request do not enter a new snapshot", async () => {
    const h = harness();
    await h.start();
    await h.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "old",
      toolName: "old_probe",
      args: {},
    });
    await h.start("New goal");
    await h.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "old",
      toolName: "old_probe",
      result: {},
      isError: false,
    });
    await h.tool("next");
    await h.end(h.turn("Inspect new goal", "next"));
    expect(h.requests.at(-1)?.prompt).not.toContain("old_probe");
  });

  test("caller abort discards valid recommendations", async () => {
    let calls = 0;
    const h = harness(async () => {
      if (++calls === 2) {
        h.controller.abort();
        return recommend("gjs");
      }
      return noMatch;
    });
    await h.start();
    await h.tool("call");
    expect(await h.end()).toBeUndefined();
    expect((await h.status()).midTask.state).toBe("cancelled");
  });
});

describe("mid-task snapshot bounds", () => {
  test("bounds excerpts and refuses an oversized combined snapshot", () => {
    const snapshot = {
      goal: "g".repeat(10_000),
      latestVisibleActivity: "v".repeat(10_000),
      visibleActivity: [],
      toolObservations: [],
      deltaVisibleActivity: [],
      deltaToolObservations: [],
      alreadyRead: [],
      alreadyRecommended: [],
    };
    expect(buildMidTaskPrompt(snapshot)?.length).toBeLessThanOrEqual(MAX_MID_TASK_PROMPT_CHARS);
    expect(
      buildMidTaskPrompt({
        ...snapshot,
        alreadyRead: Array.from({ length: 1000 }, (_, i) => `skill-${i}`),
      }),
    ).toBeUndefined();
  });
  test("redacts before truncation, including private keys and quoted credentials", () => {
    expect(sanitizeClassifierText('password="sensitive value" tail', 100)).toBe("[redacted] tail");
    expect(sanitizeClassifierText("-----BEGIN PRIVATE KEY-----\nprivate body", 10)).not.toContain(
      "private",
    );
    expect(sanitizeClassifierText("Bearer secret_value", 9)).not.toContain("secret");
  });
});
