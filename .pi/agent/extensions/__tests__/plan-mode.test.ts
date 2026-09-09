import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planMode, { PLAN_MODE_STATUS } from "../plan-mode";

type ToggleHandler = (args: string, ctx: ExtensionContext) => Promise<void>;
type ShortcutHandler = (ctx: ExtensionContext) => Promise<void>;

const buildModel = { provider: "openai-codex", id: "gpt-5.6-luna-fast" };
const planModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
const alternateBuildModel = { provider: "openai-codex", id: "gpt-5.6-terra-fast" };
const alternatePlanModel = { provider: "openai-codex", id: "gpt-5.6-sol-fast" };

type ModeConfigLoader = NonNullable<Parameters<typeof planMode>[1]>;
type EventHandler = (event: never, context: ExtensionContext) => unknown | Promise<unknown>;

interface PersistedEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function createHarness(options: {
  activeTools: string[];
  availableTools?: string[];
  idle?: boolean;
  planModelAvailable?: boolean;
  loadModes?: ModeConfigLoader;
  sessionId?: string;
  sessionFile?: string;
  entries?: PersistedEntry[];
  mode?: ExtensionContext["mode"];
  parentSession?: string;
  setModel?: (model: unknown) => Promise<boolean>;
  systemPrompt?: string;
}) {
  let activeTools = [...options.activeTools];
  let idle = options.idle ?? true;
  let toggle: ToggleHandler | undefined;
  let shortcut: ShortcutHandler | undefined;
  const handlers = new Map<string, EventHandler>();
  const entries = options.entries ?? [];
  const sessionId = options.sessionId ?? "session-1";
  const sessionFile = options.sessionFile ?? `/tmp/${sessionId}.jsonl`;
  const selectedModels: unknown[] = [];
  const sentMessages: Array<{
    message: { customType: string; content: string; display: boolean };
    options: { deliverAs?: string; triggerTurn?: boolean } | undefined;
  }> = [];
  const thinkingLevels: string[] = [];
  const activeToolSets: string[][] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notifications: Array<[string, string]> = [];

  let currentThinkingLevel = "off";
  const pi = {
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
    getAllTools: () =>
      [...new Set([...activeTools, ...(options.availableTools ?? [])])].map((name) => ({ name })),
    getActiveTools: () => [...activeTools],
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    },
    registerCommand: (name: string, command: { handler: ToggleHandler }) => {
      if (name === "plan") toggle = command.handler;
    },
    registerShortcut: (name: string, command: { handler: ShortcutHandler }) => {
      if (name === "tab") shortcut = command.handler;
    },
    sendMessage: (
      message: { customType: string; content: string; display: boolean },
      sendOptions: { deliverAs?: string; triggerTurn?: boolean } | undefined,
    ) => {
      sentMessages.push({ message, options: sendOptions });
    },
    setActiveTools: (tools: string[]) => {
      activeTools = [...tools];
      activeToolSets.push([...tools]);
    },
    setModel: async (model: unknown) => {
      selectedModels.push(model);
      return options.setModel?.(model) ?? true;
    },
    getThinkingLevel: () => currentThinkingLevel,
    setThinkingLevel: (level: string) => {
      currentThinkingLevel = level;
      thinkingLevels.push(level);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    getSystemPrompt: () => options.systemPrompt ?? "base system prompt",
    isIdle: () => idle,
    mode: options.mode ?? "tui",
    modelRegistry: {
      find: (provider: string, id: string) => {
        if (provider === planModel.provider && id === planModel.id) {
          return options.planModelAvailable === false ? undefined : planModel;
        }

        if (provider === alternateBuildModel.provider && id === alternateBuildModel.id) {
          return alternateBuildModel;
        }

        if (provider === alternatePlanModel.provider && id === alternatePlanModel.id) {
          return alternatePlanModel;
        }

        return provider === buildModel.provider && id === buildModel.id ? buildModel : undefined;
      },
    },
    sessionManager: {
      getEntries: () => [...entries],
      getHeader: () => ({ id: sessionId, parentSession: options.parentSession }),
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
    },
  } as unknown as ExtensionContext;

  planMode(pi, options.loadModes);

  return {
    get activeTools() {
      return activeTools;
    },
    activeToolSets,
    entries,
    notifications,
    selectedModels,
    sentMessages,
    setIdle(value: boolean) {
      idle = value;
    },
    selectModel(model: { provider: string; id: string }) {
      void handlers.get("model_select")?.({ model, source: "set" } as never, ctx);
    },
    selectThinkingLevel(level: string) {
      currentThinkingLevel = level;
      void handlers.get("thinking_level_select")?.({ level, previousLevel: level } as never, ctx);
    },
    async beforeAgentStart(systemPrompt = options.systemPrompt ?? "base system prompt") {
      return handlers.get("before_agent_start")?.({ systemPrompt } as never, ctx);
    },
    async startSession(reason: "new" | "reload" | "resume") {
      await handlers.get("session_start")?.({ reason } as never, ctx);
    },
    async shutdown() {
      await handlers.get("session_shutdown")?.({} as never, ctx);
    },
    statuses,
    thinkingLevels,
    async shortcut() {
      if (shortcut === undefined) throw new Error("Tab shortcut was not registered");
      await shortcut(ctx);
    },
    async toggle() {
      if (toggle === undefined) throw new Error("Plan command was not registered");
      await toggle("", ctx);
    },
  };
}

describe("plan mode", () => {
  test("does not override a subagent model or inject parent build instructions", async () => {
    const harness = createHarness({
      activeTools: ["read", "write"],
      mode: "json",
      parentSession: "parent-session-id",
      systemPrompt:
        '<active_agent name="review"/>\n\n# Environment\nWorking directory: /tmp/review',
    });

    await harness.startSession("new");
    const beforeAgentStart = await harness.beforeAgentStart();

    expect(harness.selectedModels).toEqual([]);
    expect(harness.thinkingLevels).toEqual([]);
    expect(beforeAgentStart).toBeUndefined();
  });

  test("keeps normal build setup in a noninteractive parent session", async () => {
    const harness = createHarness({
      activeTools: ["read", "write"],
      mode: "json",
      parentSession: "/parent/session.jsonl",
    });

    await harness.startSession("new");
    const beforeAgentStart = await harness.beforeAgentStart();

    expect(harness.selectedModels).toEqual([buildModel]);
    expect(harness.thinkingLevels).toEqual(["xhigh"]);
    expect(beforeAgentStart).toEqual({
      systemPrompt: expect.stringContaining("You are Pi's primary build agent."),
    });
  });

  test("inherits plan-mode tool restrictions in subagent sessions", async () => {
    const parent = createHarness({
      activeTools: ["read"],
      availableTools: ["websearch", "context7_get-library-docs", "subagent"],
      sessionId: "plan-parent-id",
    });

    await parent.toggle();

    const child = createHarness({
      activeTools: ["read", "write", "edit", "bash"],
      availableTools: ["websearch", "context7_get-library-docs", "subagent"],
      parentSession: "plan-parent-id",
      sessionFile: "/tmp/plan-child.jsonl",
      systemPrompt: '<active_agent name="quick" />\n\n# Environment',
    });

    await child.startSession("new");

    expect(child.activeTools).toEqual([
      "read",
      "websearch",
      "context7_get-library-docs",
      "subagent",
    ]);
    expect(child.selectedModels).toEqual([]);
    expect(await child.beforeAgentStart()).toEqual({
      systemPrompt: expect.stringContaining("Plan mode is active. Work read-only"),
    });

    await child.shutdown();
    await parent.toggle();
  });

  test("entering selects the configured plan model and thinking level and keeps only read-only tools", async () => {
    const harness = createHarness({
      activeTools: [
        "read",
        "write",
        "edit",
        "bash",
        "powershell",
        "toolbox_execute",
        "find",
        "grep",
        "ls",
        "skill",
        "fffind",
        "ffgrep",
        "ask_user_question",
        "custom",
      ],
    });

    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel]);
    expect(harness.thinkingLevels).toEqual(["high"]);
    expect(harness.activeTools).toEqual([
      "read",
      "find",
      "grep",
      "ls",
      "skill",
      "fffind",
      "ffgrep",
      "ask_user_question",
    ]);
    expect(harness.statuses).toEqual([["plan-mode", PLAN_MODE_STATUS]]);
  });

  test("loads read-only tools for plan mode and retains them in build mode", async () => {
    const harness = createHarness({
      activeTools: ["read"],
      availableTools: [
        "list_symbols",
        "find_definition",
        "find_callers",
        "find_callees",
        "get_symbol_body",
        "lsp",
        "git_diff",
        "websearch",
        "webfetch",
        "read_session",
        "get_subagent_result",
        "subagent",
        "context7_resolve-library-id",
        "context7_get-library-docs",
        "mcp__context7",
        "ast-grep_ast-grep",
        "write",
        "exec",
      ],
    });

    await harness.toggle();

    expect(harness.activeTools).toEqual([
      "read",
      "list_symbols",
      "find_definition",
      "find_callers",
      "find_callees",
      "get_symbol_body",
      "lsp",
      "git_diff",
      "websearch",
      "webfetch",
      "read_session",
      "get_subagent_result",
      "subagent",
      "context7_resolve-library-id",
      "context7_get-library-docs",
      "mcp__context7",
      "ast-grep_ast-grep",
    ]);

    await harness.toggle();

    expect(harness.activeTools).toEqual(
      expect.arrayContaining([
        "websearch",
        "webfetch",
        "subagent",
        "context7_get-library-docs",
        "ast-grep_ast-grep",
      ]),
    );
  });

  test("leaving restores the exact prior tools and configured build model and thinking level", async () => {
    const originalTools = ["read", "write", "custom", "exec", "read"];
    const harness = createHarness({ activeTools: originalTools });

    await harness.toggle();
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel, buildModel]);
    expect(harness.thinkingLevels).toEqual(["high", "xhigh"]);
    expect(harness.activeTools).toEqual(originalTools);
    expect(harness.activeToolSets).toEqual([["read"], originalTools]);
    expect(harness.statuses).toEqual([
      ["plan-mode", PLAN_MODE_STATUS],
      ["plan-mode", undefined],
    ]);
  });

  test("Tab toggles between plan and build mode", async () => {
    const harness = createHarness({ activeTools: ["read", "write"] });

    await harness.shortcut();
    await harness.shortcut();

    expect(harness.selectedModels).toEqual([planModel, buildModel]);
    expect(harness.activeTools).toEqual(["read", "write"]);
    expect(harness.statuses).toEqual([
      ["plan-mode", PLAN_MODE_STATUS],
      ["plan-mode", undefined],
    ]);
  });

  test("queues build-mode context after leaving plan mode", async () => {
    const harness = createHarness({ activeTools: ["read", "write"] });

    await harness.toggle();
    await harness.toggle();

    expect(await harness.beforeAgentStart()).toEqual({
      systemPrompt: expect.stringContaining("You are Pi's primary build agent."),
    });
    expect(harness.sentMessages).toEqual([
      {
        message: {
          customType: "plan-mode-transition",
          content:
            "Plan mode is now disabled. You are in build mode. The tools active before plan mode and its read-only tools are available. Implement the user's request instead of producing another plan.",
          display: false,
        },
        options: { deliverAs: "nextTurn" },
      },
    ]);
  });

  test("uses updated mode config when switching after a session edit", async () => {
    let buildModelReference = `${buildModel.provider}/${buildModel.id}`;
    const loadModes: ModeConfigLoader = () => ({
      build: {
        model: buildModelReference,
        prompt: "./prompts/build.txt",
        thinkingLevel: "xhigh",
        color: "#66A5AD",
      },
      plan: {
        model: `${planModel.provider}/${planModel.id}`,
        prompt: "./prompts/plan.txt",
        thinkingLevel: "high",
        color: "#B279A7",
        allowedTools: new Set(["read"]),
      },
    });
    const harness = createHarness({
      activeTools: ["read", "write"],
      loadModes,
    });

    await harness.toggle();
    buildModelReference = `${alternateBuildModel.provider}/${alternateBuildModel.id}`;
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel, alternateBuildModel]);
  });

  test("keeps a picker-selected model when refreshing mode config", async () => {
    const harness = createHarness({ activeTools: ["read", "write"] });

    harness.selectModel(alternateBuildModel);
    await harness.toggle();
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel, alternateBuildModel]);
  });
  test("resets a mode's thinking level to minimal when its model changes", async () => {
    const harness = createHarness({ activeTools: ["read", "write"] });

    harness.selectThinkingLevel("low");
    harness.selectModel(alternateBuildModel);
    await harness.toggle();
    harness.selectThinkingLevel("minimal");
    harness.selectModel(alternatePlanModel);

    expect(harness.thinkingLevels).toEqual(["minimal", "high", "minimal"]);
  });

  test.each(["reload", "resume"] as const)(
    "restores build and plan model and thinking-level overrides after %s",
    async (reason) => {
      const entries: PersistedEntry[] = [];
      const initial = createHarness({
        activeTools: ["read", "write"],
        entries,
        sessionId: "session-a",
      });

      initial.selectModel(alternateBuildModel);
      initial.selectThinkingLevel("low");
      await initial.toggle();
      initial.selectThinkingLevel("minimal");
      initial.selectModel(alternatePlanModel);
      initial.selectThinkingLevel("medium");
      const restored = createHarness({
        activeTools: ["read", "write"],
        entries,
        sessionId: "session-a",
      });
      await restored.startSession(reason);
      await restored.toggle();

      expect(restored.selectedModels).toEqual([alternateBuildModel, alternatePlanModel]);
      expect(restored.thinkingLevels).toEqual(["low", "medium"]);
      expect(entries[entries.length - 1]).toEqual({
        type: "custom",
        customType: "plan-mode-models",
        data: {
          sessionId: "session-a",
          models: {
            build: `${alternateBuildModel.provider}/${alternateBuildModel.id}`,
            plan: `${alternatePlanModel.provider}/${alternatePlanModel.id}`,
          },
          thinkingLevels: { build: "low", plan: "medium" },
        },
      });
    },
  );

  test("does not inherit model overrides from a different session id", async () => {
    const initial = createHarness({
      activeTools: ["read", "write"],
      sessionId: "session-a",
    });
    initial.selectModel(alternateBuildModel);
    await initial.toggle();
    initial.selectModel(alternatePlanModel);

    const fresh = createHarness({
      activeTools: ["read", "write"],
      entries: initial.entries,
      sessionId: "session-b",
    });
    await fresh.startSession("new");
    await fresh.toggle();

    expect(fresh.selectedModels).toEqual([buildModel, planModel]);
  });

  test("an unavailable plan model fails closed without changing tools or status", async () => {
    const originalTools = ["read", "write", "exec"];
    const harness = createHarness({ activeTools: originalTools, planModelAvailable: false });

    await harness.toggle();

    expect(harness.selectedModels).toEqual([]);
    expect(harness.thinkingLevels).toEqual([]);
    expect(harness.activeTools).toEqual(originalTools);
    expect(harness.activeToolSets).toEqual([]);
    expect(harness.statuses).toEqual([]);
    expect(harness.notifications).toEqual([
      ["Configured plan model is unavailable: openai-codex/gpt-5.6-sol", "error"],
    ]);
  });

  test("toggling while busy leaves plan mode enabled until an idle toggle exits it", async () => {
    const originalTools = ["read", "write", "exec"];
    const harness = createHarness({ activeTools: originalTools });

    await harness.toggle();
    harness.setIdle(false);
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel]);
    expect(harness.thinkingLevels).toEqual(["high"]);
    expect(harness.activeTools).toEqual(["read"]);
    expect(harness.statuses).toEqual([["plan-mode", PLAN_MODE_STATUS]]);
    expect(harness.notifications).toEqual([
      ["Wait for the current response to finish before switching modes.", "warning"],
    ]);
    expect(harness.sentMessages).toEqual([]);

    harness.setIdle(true);
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel, buildModel]);
    expect(harness.thinkingLevels).toEqual(["high", "xhigh"]);
    expect(harness.activeTools).toEqual(originalTools);
    expect(harness.statuses).toEqual([
      ["plan-mode", PLAN_MODE_STATUS],
      ["plan-mode", undefined],
    ]);
  });

  test("ignores a repeated toggle while model selection is pending", async () => {
    let resolveModel!: (available: boolean) => void;
    const modelSelection = new Promise<boolean>((resolve) => {
      resolveModel = resolve;
    });
    const harness = createHarness({
      activeTools: ["read", "write"],
      setModel: async () => modelSelection,
    });

    const firstToggle = harness.shortcut();
    await Promise.resolve();
    const secondToggle = harness.shortcut();
    resolveModel(true);
    await Promise.all([firstToggle, secondToggle]);

    expect(harness.selectedModels).toEqual([planModel]);
    expect(harness.activeTools).toEqual(["read"]);
    expect(harness.statuses).toEqual([["plan-mode", PLAN_MODE_STATUS]]);
  });
});
