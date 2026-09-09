import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type McpToolApprovalDecision,
  type McpToolApprovalRequest,
  registerMcpApprovalRouting,
} from "../mcp-approval";
import { PERMISSIONS_STRICT_STATE_CHANNEL } from "../permissions-mode";

const MCP_APPROVAL_CHANNEL = "pi-mcp-adapter:tool-approval-request";

type ApprovalHandler = () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>;
type EventHandler = (value: unknown) => void;
type LifecycleHandler = (...args: unknown[]) => void;

interface RoutingHarness {
  emitApproval(value: unknown): void;
  emitStrictState(value: unknown): void;
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
    emitStrictState: (value) => emit(PERMISSIONS_STRICT_STATE_CHANNEL, value),
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
  test("auto-approves active-session requests in normal mode", async () => {
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.emitStrictState({ sessionId: "mcp-normal", strictEnabled: true });
    harness.start(
      createSelectContext(async () => {
        prompts += 1;
        return "3. Deny";
      }, "mcp-normal"),
    );
    const normalApproval = createApprovalRequest();
    harness.emitApproval(normalApproval.request);

    expect(harness.listenerCount(MCP_APPROVAL_CHANNEL)).toBe(1);
    expect(harness.listenerCount(PERMISSIONS_STRICT_STATE_CHANNEL)).toBe(1);
    expect(await normalApproval.decision()).toBe("allow_once");
    expect(prompts).toBe(0);
  });

  test("prompts only when matching-session strict mode is enabled", async () => {
    let prompts = 0;
    const harness = createRoutingHarness();
    harness.start(
      createSelectContext(async (_title, options) => {
        prompts += 1;
        return options[0];
      }, "mcp-active"),
    );

    harness.emitStrictState({ sessionId: "other-session", strictEnabled: true });
    harness.emitStrictState({ sessionId: "mcp-active", strictEnabled: "true" });
    const stillNormal = createApprovalRequest();
    harness.emitApproval(stillNormal.request);
    expect(await stillNormal.decision()).toBe("allow_once");

    harness.emitStrictState({ sessionId: "mcp-active", strictEnabled: true });
    const strictApproval = createApprovalRequest();
    harness.emitApproval(strictApproval.request);
    expect(await strictApproval.decision()).toBe("allow_once");

    harness.emitStrictState({ sessionId: "mcp-active", strictEnabled: false });
    const normalAgain = createApprovalRequest();
    harness.emitApproval(normalAgain.request);
    expect(await normalAgain.decision()).toBe("allow_once");
    expect(prompts).toBe(1);
  });

  test("routes a strict request through the question prompt", async () => {
    let prompt: { title: string; options: string[] } | undefined;
    const context = createSelectContext(async (title, options) => {
      prompt = { title, options };
      return options[0];
    });
    const harness = createRoutingHarness();
    const approval = createApprovalRequest({
      serverName: "github\nspoof",
      toolName: "search\u001b_code",
    });
    harness.start(context);
    harness.emitStrictState({ sessionId: "mcp-session", strictEnabled: true });

    harness.emitApproval(approval.request);

    expect(approval.claimCount()).toBe(1);
    expect(await approval.decision()).toBe("allow_once");
    expect(prompt?.title).toContain("MCP: github spoof wants to run search _code");
    expect(prompt?.title).toContain("Arguments:");
    expect(prompt?.options).toEqual(["1. Allow once", "2. Deny"]);
  });

  test("leaves fallback ownership to the adapter outside an active session", async () => {
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
    expect(await headless.decision()).toBe("allow_once");

    harness.emitStrictState({ sessionId: "headless", strictEnabled: true });
    const strictHeadless = createApprovalRequest();
    harness.emitApproval(strictHeadless.request);
    expect(await strictHeadless.decision()).toBe("deny");

    harness.shutdown();
    const afterShutdown = createApprovalRequest();
    harness.emitApproval(afterShutdown.request);
    expect(afterShutdown.claimCount()).toBe(0);
  });

  test("strict broker decisions override cached MCP session grants", async () => {
    const moduleUrl = new URL(
      "../../npm/node_modules/pi-mcp-adapter/tool-approval.ts",
      import.meta.url,
    ).href;
    const { ensureToolCallApproved } = (await import(moduleUrl)) as {
      ensureToolCallApproved(
        state: unknown,
        serverName: string,
        metadata: unknown,
        args: Record<string, unknown>,
      ): Promise<{ ok: true } | { ok: false; reason: string }>;
    };
    let decision: McpToolApprovalDecision = "allow_for_session";
    const state = {
      config: { mcpServers: {} },
      approvalEvents: {
        emit(_name: string, value: unknown) {
          const request = value as McpToolApprovalRequest;
          request.claim(() => decision);
        },
      },
    };
    const metadata = { name: "github_search_code", originalName: "search_code" };

    expect(
      await ensureToolCallApproved(state as never, "github", metadata as never, {
        query: "repo:example",
      }),
    ).toEqual({ ok: true });

    decision = "deny";
    expect(
      await ensureToolCallApproved(state as never, "github", metadata as never, {
        query: "repo:example",
      }),
    ).toEqual({ ok: false, reason: "denied" });
  });

  test("returns to normal mode on a new session", async () => {
    let prompts = 0;
    const context = createSelectContext(async (_title, options) => {
      prompts += 1;
      return options[2];
    }, "mcp-reload");
    const harness = createRoutingHarness();
    harness.start(context);
    harness.emitStrictState({ sessionId: "mcp-reload", strictEnabled: true });
    harness.shutdown();
    harness.start(context);
    const approval = createApprovalRequest();

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("allow_once");
    expect(prompts).toBe(0);
  });

  test("denies when the user cancels a strict approval prompt", async () => {
    const harness = createRoutingHarness();
    harness.start(createSelectContext(async () => undefined));
    harness.emitStrictState({ sessionId: "mcp-session", strictEnabled: true });
    const approval = createApprovalRequest();

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
  });

  test("fails closed when strict approval arguments cannot be displayed", async () => {
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
    harness.emitStrictState({ sessionId: "mcp-session", strictEnabled: true });
    const approval = createApprovalRequest({ args });

    harness.emitApproval(approval.request);

    expect(await approval.decision()).toBe("deny");
    expect(prompts).toBe(0);
  });
});
