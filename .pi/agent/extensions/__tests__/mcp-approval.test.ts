import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type McpToolApprovalDecision,
  type McpToolApprovalRequest,
  registerMcpApprovalRouting,
} from "../mcp-approval";
import { YOLO_EFFECTIVE_STATE_CHANNEL } from "../yolo";

const MCP_APPROVAL_CHANNEL = "pi-mcp-adapter:tool-approval-request";

type ApprovalHandler = () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>;
type EventHandler = (value: unknown) => void;
type LifecycleHandler = (...args: unknown[]) => void;

interface RoutingHarness {
  emitApproval(value: unknown): void;
  emitYoloState(value: unknown): void;
  listenerCount(name: string): number;
  start(ctx: ExtensionContext): void;
  shutdown(): void;
}

function createRoutingHarness(): RoutingHarness {
  const lifecycleHandlers = new Map<string, LifecycleHandler>();
  const eventHandlers = new Map<string, EventHandler[]>();
  const pi = {
    on(name: string, handler: LifecycleHandler) {
      lifecycleHandlers.set(name, handler);
    },
    events: {
      on(name: string, handler: EventHandler) {
        const handlers = eventHandlers.get(name) ?? [];
        handlers.push(handler);
        eventHandlers.set(name, handlers);
        return () => undefined;
      },
    },
  } as unknown as ExtensionAPI;

  registerMcpApprovalRouting(pi);

  const emit = (name: string, value: unknown) => {
    for (const handler of eventHandlers.get(name) ?? []) handler(value);
  };

  return {
    emitApproval: (value) => emit(MCP_APPROVAL_CHANNEL, value),
    emitYoloState: (value) => emit(YOLO_EFFECTIVE_STATE_CHANNEL, value),
    listenerCount: (name) => eventHandlers.get(name)?.length ?? 0,
    start(ctx) {
      lifecycleHandlers.get("session_start")?.({}, ctx);
    },
    shutdown() {
      lifecycleHandlers.get("session_shutdown")?.({});
    },
  };
}

function createApprovalRequest(
  options: {
    args?: Record<string, unknown>;
    serverName?: string;
    toolName?: string;
    acceptClaim?: boolean;
  } = {},
): {
  request: McpToolApprovalRequest;
  claimCount(): number;
  decision(): Promise<McpToolApprovalDecision>;
} {
  let handler: ApprovalHandler | undefined;
  let claims = 0;
  const request: McpToolApprovalRequest = {
    serverName: options.serverName ?? "github",
    originalToolName: options.toolName ?? "search_code",
    args: options.args ?? { query: "repo:hyprwm/Hyprland dragThresholdReached" },
    claim(candidate) {
      claims += 1;
      if (options.acceptClaim === false || handler !== undefined) return false;
      handler = candidate;
      return true;
    },
  };

  return {
    request,
    claimCount: () => claims,
    async decision() {
      if (handler === undefined) throw new Error("MCP approval was not claimed");
      return handler();
    },
  };
}

function createSelectContext(
  select: (title: string, options: string[]) => Promise<string | undefined>,
  sessionId = "mcp-session",
  entries: unknown[] = [],
): ExtensionContext {
  return {
    hasUI: true,
    mode: "rpc",
    ui: {
      input: async () => undefined,
      notify: () => undefined,
      select,
    },
    sessionManager: {
      getHeader: () => ({ id: sessionId }),
      getEntries: () => entries,
    },
  } as unknown as ExtensionContext;
}

describe("MCP approval routing", () => {
  test("uses one broker listener and ignores effective state before session start", async () => {
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.emitYoloState({ sessionId: "mcp-yolo", effectiveEnabled: true });
    harness.start(
      createSelectContext(async () => {
        prompts += 1;
        return "3. Deny";
      }, "mcp-yolo"),
    );
    const beforeRegistration = createApprovalRequest();
    harness.emitApproval(beforeRegistration.request);

    expect(harness.listenerCount(MCP_APPROVAL_CHANNEL)).toBe(1);
    expect(harness.listenerCount(YOLO_EFFECTIVE_STATE_CHANNEL)).toBe(1);
    expect(await beforeRegistration.decision()).toBe("deny");

    harness.emitYoloState({ sessionId: "mcp-yolo", effectiveEnabled: true });
    const afterRegistration = createApprovalRequest();
    harness.emitApproval(afterRegistration.request);
    expect(await afterRegistration.decision()).toBe("allow_once");
    expect(prompts).toBe(1);
  });

  test("applies effective state changes only to the matching active session", async () => {
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.start(
      createSelectContext(async (_title, options) => {
        prompts += 1;
        return options[1];
      }, "mcp-active"),
    );
    harness.emitYoloState({ sessionId: "other-session", effectiveEnabled: true });
    harness.emitYoloState({ sessionId: "mcp-active", effectiveEnabled: "true" });
    const promptedApproval = createApprovalRequest();
    harness.emitApproval(promptedApproval.request);

    expect(await promptedApproval.decision()).toBe("allow_for_session");
    expect(prompts).toBe(1);

    harness.emitYoloState({ sessionId: "mcp-active", effectiveEnabled: true });
    const yoloApproval = createApprovalRequest();
    harness.emitApproval(yoloApproval.request);
    expect(await yoloApproval.decision()).toBe("allow_once");

    harness.emitYoloState({ sessionId: "mcp-active", effectiveEnabled: false });
    const promptedAgain = createApprovalRequest();
    harness.emitApproval(promptedAgain.request);
    expect(await promptedAgain.decision()).toBe("allow_for_session");
    expect(prompts).toBe(2);
  });

  test("does not treat persisted requested state as effective", async () => {
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.start(
      createSelectContext(
        async (_title, options) => {
          prompts += 1;
          return options[2];
        },
        "mcp-persisted",
        [
          {
            type: "custom",
            customType: "yolo-mode",
            data: { sessionId: "mcp-persisted", enabled: true },
          },
        ],
      ),
    );
    const approval = createApprovalRequest();

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
    expect(prompts).toBe(1);
  });

  test("routes an interactive request through the question prompt", async () => {
    let prompt: { title: string; options: string[] } | undefined;
    const context = createSelectContext(async (title, options) => {
      prompt = { title, options };
      return options[1];
    });
    const harness = createRoutingHarness();
    const approval = createApprovalRequest({
      serverName: "github\nspoof",
      toolName: "search\u001b_code",
    });
    harness.start(context);

    harness.emitApproval(approval.request);

    expect(approval.claimCount()).toBe(1);
    expect(await approval.decision()).toBe("allow_for_session");
    expect(prompt?.title).toContain("MCP: github spoof wants to run search _code");
    expect(prompt?.title).toContain("Arguments:");
    expect(prompt?.options).toEqual(["1. Allow once", "2. Allow for session", "3. Deny"]);
  });

  test("leaves fallback ownership to the adapter without an active UI", () => {
    const harness = createRoutingHarness();
    const beforeStart = createApprovalRequest();
    harness.emitApproval(beforeStart.request);
    expect(beforeStart.claimCount()).toBe(0);

    harness.start({
      hasUI: false,
      sessionManager: { getHeader: () => ({ id: "headless" }) },
    } as ExtensionContext);
    const headless = createApprovalRequest();
    harness.emitApproval(headless.request);
    expect(headless.claimCount()).toBe(0);

    harness.shutdown();
    const afterShutdown = createApprovalRequest();
    harness.emitApproval(afterShutdown.request);
    expect(afterShutdown.claimCount()).toBe(0);
  });

  test("clears effective state on shutdown", async () => {
    let prompts = 0;
    const context = createSelectContext(async (_title, options) => {
      prompts += 1;
      return options[2];
    }, "mcp-reload");
    const harness = createRoutingHarness();
    harness.start(context);
    harness.emitYoloState({ sessionId: "mcp-reload", effectiveEnabled: true });
    harness.shutdown();
    harness.start(context);
    const approval = createApprovalRequest();

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
    expect(prompts).toBe(1);
  });

  test("denies when the user cancels the approval prompt", async () => {
    const harness = createRoutingHarness();
    harness.start(createSelectContext(async () => undefined));
    const approval = createApprovalRequest();

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
  });

  test("fails closed when approval arguments cannot be displayed", async () => {
    const args: Record<string, unknown> = {};
    args.self = args;
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.start(
      createSelectContext(async () => {
        prompts += 1;
        return "1. Allow once";
      }),
    );
    const approval = createApprovalRequest({ args });

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
    expect(prompts).toBe(0);
  });
});
