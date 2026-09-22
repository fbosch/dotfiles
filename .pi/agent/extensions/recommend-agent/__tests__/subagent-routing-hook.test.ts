import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { RecommendationEvaluation } from "../recommendation";
import { DEFAULT_RECOMMEND_AGENT_CONFIG } from "../settings";
import {
  registerSubagentRoutingHook,
  type SubagentRoutingHookDependencies,
} from "../subagent-routing-hook";

// Keep the harness at the public event seam: registration and emitted events.
type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

interface HarnessOptions {
  readonly hasUI?: boolean;
  readonly throwOnAppend?: boolean;
  readonly throwOnNotify?: boolean;
}

function createHarness(
  dependencies: SubagentRoutingHookDependencies = {},
  options: HarnessOptions = {},
) {
  const handlers = new Map<string, EventHandler>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  const pi = {
    on(name: string, handler: EventHandler) {
      handlers.set(name, handler);
    },
    appendEntry(customType: string, data: unknown) {
      if (options.throwOnAppend) throw new Error("session write failed");
      entries.push({ customType, data });
    },
    sendMessage() {
      throw new Error("unexpected sendMessage");
    },
    sendUserMessage() {
      throw new Error("unexpected sendUserMessage");
    },
  } as unknown as ExtensionAPI;
  registerSubagentRoutingHook(pi, dependencies);

  const root = mkdtempSync(join(tmpdir(), "subagent-routing-hook-test-"));
  temporaryDirectories.push(root);
  const context = {
    cwd: root,
    hasUI: options.hasUI ?? false,
    isProjectTrusted: () => false,
    modelRegistry: {},
    signal: undefined,
    sessionManager: { getBranch: () => [] },
    ui: {
      notify(message: string, type?: "info" | "warning" | "error") {
        if (options.throwOnNotify) throw new Error("ui failed");
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionContext;

  return {
    context,
    entries,
    notifications,
    root,
    async emit(name: string, event: unknown): Promise<unknown> {
      const handler = handlers.get(name);
      if (handler === undefined) throw new Error(`Missing handler: ${name}`);
      return handler(event, context);
    },
  };
}

function subagentCall(
  subagentType = "review",
  prompt = "Review this change for regressions.",
  extra: Record<string, unknown> = {},
): ToolCallEvent {
  return {
    type: "tool_call",
    toolName: "subagent",
    toolCallId: "call-1",
    input: { subagent_type: subagentType, prompt, ...extra },
  } as ToolCallEvent;
}

function evaluation(decision: RecommendationEvaluation["decision"]): RecommendationEvaluation {
  return { decision };
}

const enabled = { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: true };
const userPrompt = {
  type: "message",
  message: { role: "user", content: "@review Please handle this task." },
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("subagent routing hook", () => {
  test("allows agreement and evaluates only the first delegation in a turn", async () => {
    const requests: Array<{ task: string; intent: string }> = [];
    const harness = createHarness(
      {
        readConfig: () => enabled,
        evaluate: async (request) => {
          requests.push(request);
          return evaluation({ decision: "recommend", agentId: "review" });
        },
      },
      { hasUI: true },
    );

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    const call = subagentCall();
    const originalInput = { ...call.input };
    expect(await harness.emit("tool_call", call)).toBeUndefined();
    expect(
      await harness.emit("tool_call", subagentCall("review", "Another task.")),
    ).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.task).toBe("Review this change for regressions.");
    expect(call.input).toEqual(originalInput);
    expect(harness.notifications.map(({ message }) => message)).toEqual(["Jev → review ✓"]);
    expect(harness.entries).toHaveLength(1);
    expect(harness.entries[0]).toMatchObject({
      customType: "recommend-agent-routing",
      data: {
        version: 1,
        proposedAgentId: "review",
        selectedAgentId: "review",
        decision: "agreement",
      },
    });
    expect(JSON.stringify(harness.entries)).not.toContain("Review this change");
  });

  test("blocks disagreement exactly once, then permits the primary's reconsidered call", async () => {
    const harness = createHarness(
      {
        readConfig: () => enabled,
        evaluate: async () => evaluation({ decision: "recommend", agentId: "debug" }),
      },
      { hasUI: true },
    );

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toEqual({
      block: true,
      reason: "Jev routing recommends debug instead; reconsider this delegation.",
    });
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();
    expect(harness.notifications.map(({ message }) => message)).toEqual([
      "Jev → debug (proposed review)",
    ]);
    expect(harness.entries[0]?.data).toMatchObject({
      proposedAgentId: "review",
      selectedAgentId: "debug",
      decision: "disagreement",
    });
  });

  test("blocks stay, but fails open for abstention and inference errors", async () => {
    let result: RecommendationEvaluation = evaluation({ decision: "stay" });
    let shouldThrow = false;
    const harness = createHarness(
      {
        readConfig: () => enabled,
        evaluate: async () => {
          if (shouldThrow) throw new Error("gateway unavailable");
          return result;
        },
      },
      { hasUI: true },
    );

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toMatchObject({ block: true });

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle another task.",
      systemPrompt: "",
    });
    result = evaluation({ decision: "abstain", reason: "model-abstain" });
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle a third task.",
      systemPrompt: "",
    });
    shouldThrow = true;
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();
    expect(harness.notifications.map(({ message }) => message)).toEqual([
      "Jev → primary (proposed review)",
      "Jev → abstain; proceeding",
      "Jev unavailable: evaluation failed; proceeding",
    ]);
    expect(harness.entries).toHaveLength(3);
    expect(harness.entries.map(({ data }) => (data as { decision: string }).decision)).toEqual([
      "stay",
      "abstain",
      "unavailable",
    ]);
  });

  test("shows safe gateway failure diagnostics without leaking the delegation prompt", async () => {
    const harness = createHarness(
      {
        readConfig: () => enabled,
        evaluate: async () => ({
          decision: { decision: "abstain", reason: "gateway-failure" },
          gatewayFailure: "missing-credentials",
          gatewayProvider: "vercel-ai-gateway",
        }),
      },
      { hasUI: true },
    );
    const call = subagentCall("review", "Bearer supersecret /Users/fbb/private task");

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", call)).toBeUndefined();
    expect(harness.notifications.map(({ message }) => message)).toEqual([
      "Jev unavailable: missing credentials; proceeding",
    ]);
    expect(harness.entries[0]?.data).toMatchObject({
      proposedAgentId: "review",
      decision: "unavailable",
      reason: "gateway-failure",
      gatewayFailure: "missing-credentials",
      gatewayProvider: "vercel-ai-gateway",
    });
    expect(JSON.stringify(harness.entries)).not.toContain("supersecret");
    expect(JSON.stringify(harness.entries)).not.toContain("/Users/fbb/private");
  });

  test("persists diagnostics in headless mode without notifying", async () => {
    const harness = createHarness({
      readConfig: () => enabled,
      evaluate: async () => evaluation({ decision: "recommend", agentId: "review" }),
    });

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();
    expect(harness.notifications).toHaveLength(0);
    expect(harness.entries).toHaveLength(1);
  });

  test("diagnostic surface failures do not change blocking or call message APIs", async () => {
    const harness = createHarness(
      {
        readConfig: () => enabled,
        evaluate: async () => evaluation({ decision: "recommend", agentId: "debug" }),
      },
      { hasUI: true, throwOnAppend: true, throwOnNotify: true },
    );

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toEqual({
      block: true,
      reason: "Jev routing recommends debug instead; reconsider this delegation.",
    });
    expect(harness.entries).toHaveLength(0);
    expect(harness.notifications).toHaveLength(0);
  });

  test("bypasses explicit user-selected agents and resume calls", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "subagent-routing-agents-"));
    temporaryDirectories.push(agentDir);
    const agentsDir = join(agentDir, "agents");
    mkdirSync(agentsDir);
    writeFileSync(join(agentsDir, "review.md"), "---\ndescription: Review changes\n---\n");

    let evaluations = 0;
    const harness = createHarness({
      agentDirectory: agentDir,
      readConfig: () => enabled,
      evaluate: async () => {
        evaluations += 1;
        return evaluation({ decision: "stay" });
      },
    });
    (harness.context.sessionManager as unknown as { getBranch: () => unknown[] }).getBranch =
      () => [userPrompt];

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Please handle this task.",
      systemPrompt: "",
    });
    expect(
      await harness.emit(
        "tool_call",
        subagentCall("review", "Answer the agent.", { resume: "agent-1" }),
      ),
    ).toBeUndefined();
    expect(evaluations).toBe(0);
  });

  test("resets the one-advisory budget on a new user turn and session start", async () => {
    const harness = createHarness({
      readConfig: () => enabled,
      evaluate: async () => evaluation({ decision: "recommend", agentId: "debug" }),
    });

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "First task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toMatchObject({ block: true });
    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();

    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Second task.",
      systemPrompt: "",
    });
    expect(await harness.emit("tool_call", subagentCall())).toMatchObject({ block: true });

    await harness.emit("session_start", { type: "session_start", reason: "resume" });
    expect(await harness.emit("tool_call", subagentCall())).toMatchObject({ block: true });
  });

  test("is disabled without evaluating or blocking", async () => {
    let evaluations = 0;
    const harness = createHarness({
      readConfig: () => ({ ...enabled, enabled: false }),
      evaluate: async () => {
        evaluations += 1;
        return evaluation({ decision: "stay" });
      },
    });

    expect(await harness.emit("tool_call", subagentCall())).toBeUndefined();
    expect(evaluations).toBe(0);
  });
});
