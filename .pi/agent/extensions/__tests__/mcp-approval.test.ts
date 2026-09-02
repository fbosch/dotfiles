import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type McpApprovalRoutingDependencies,
  type McpToolApprovalDecision,
  type McpToolApprovalRequest,
  registerMcpApprovalRouting,
} from "../mcp-approval";

type ApprovalHandler = () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>;
type EventHandler = (value: unknown) => void;
type LifecycleHandler = (...args: unknown[]) => void;

interface RoutingHarness {
  eventName: string;
  listenerCount: number;
  emit(value: unknown): void;
  start(ctx: ExtensionContext): void;
  shutdown(): void;
}

function createRoutingHarness(
  dependencies: McpApprovalRoutingDependencies = { isYoloModeEnabled: () => false },
): RoutingHarness {
  const lifecycleHandlers = new Map<string, LifecycleHandler>();
  const eventHandlers: Array<{ name: string; handler: EventHandler }> = [];
  const pi = {
    on(name: string, handler: LifecycleHandler) {
      lifecycleHandlers.set(name, handler);
    },
    events: {
      on(name: string, handler: EventHandler) {
        eventHandlers.push({ name, handler });
        return () => undefined;
      },
    },
  } as unknown as ExtensionAPI;

  registerMcpApprovalRouting(pi, dependencies);

  return {
    get eventName() {
      return eventHandlers[0]?.name ?? "";
    },
    get listenerCount() {
      return eventHandlers.length;
    },
    emit(value) {
      if (eventHandlers.length === 0) throw new Error("MCP approval event was not registered");
      for (const { handler } of eventHandlers) handler(value);
    },
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
): ExtensionContext {
  return {
    hasUI: true,
    mode: "rpc",
    ui: {
      input: async () => undefined,
      notify: () => undefined,
      select,
    },
  } as unknown as ExtensionContext;
}

describe("MCP approval routing", () => {
  test("registers one broker listener and gives YOLO precedence over UI", async () => {
    let prompts = 0;
    const harness = createRoutingHarness({ isYoloModeEnabled: () => true });
    const headlessApproval = createApprovalRequest();
    harness.emit(headlessApproval.request);

    harness.start(
      createSelectContext(async () => {
        prompts += 1;
        return "3. Deny";
      }),
    );
    const interactiveApproval = createApprovalRequest();
    harness.emit(interactiveApproval.request);

    expect(harness.eventName).toBe("pi-mcp-adapter:tool-approval-request");
    expect(harness.listenerCount).toBe(1);
    expect(headlessApproval.claimCount()).toBe(1);
    expect(await headlessApproval.decision()).toBe("allow_once");
    expect(await interactiveApproval.decision()).toBe("allow_once");
    expect(prompts).toBe(0);
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

    harness.emit(approval.request);

    expect(approval.claimCount()).toBe(1);
    expect(await approval.decision()).toBe("allow_for_session");
    expect(prompt?.title).toContain("MCP: github spoof wants to run search _code");
    expect(prompt?.title).toContain("Arguments:");
    expect(prompt?.options).toEqual(["1. Allow once", "2. Allow for session", "3. Deny"]);
  });

  test("leaves fallback ownership to the adapter without an active UI", () => {
    const harness = createRoutingHarness();
    const beforeStart = createApprovalRequest();
    harness.emit(beforeStart.request);
    expect(beforeStart.claimCount()).toBe(0);

    harness.start({ hasUI: true } as ExtensionContext);
    harness.shutdown();
    const afterShutdown = createApprovalRequest();
    harness.emit(afterShutdown.request);
    expect(afterShutdown.claimCount()).toBe(0);
  });

  test("denies when the user cancels the approval prompt", async () => {
    const harness = createRoutingHarness();
    harness.start(createSelectContext(async () => undefined));
    const approval = createApprovalRequest();

    harness.emit(approval.request);

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

    harness.emit(approval.request);

    expect(await approval.decision()).toBe("deny");
    expect(prompts).toBe(0);
  });
});
