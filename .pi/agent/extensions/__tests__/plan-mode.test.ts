import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planMode, { PLAN_MODE_STATUS } from "../plan-mode";

type ToggleHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

const buildModel = { provider: "openai-codex", id: "gpt-5.6-luna-fast" };
const planModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
const alternateBuildModel = { provider: "openai-codex", id: "gpt-5.6-terra-fast" };
const alternatePlanModel = { provider: "openai-codex", id: "gpt-5.6-sol-fast" };

type ModeConfigLoader = NonNullable<Parameters<typeof planMode>[1]>;
type EventHandler = (event: never, context: ExtensionContext) => void | Promise<void>;

interface PersistedEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

function createHarness(options: {
  activeTools: string[];
  idle?: boolean;
  planModelAvailable?: boolean;
  loadModes?: ModeConfigLoader;
  sessionId?: string;
  entries?: PersistedEntry[];
}) {
  let activeTools = [...options.activeTools];
  let idle = options.idle ?? true;
  let toggle: ToggleHandler | undefined;
  const handlers = new Map<string, EventHandler>();
  const entries = options.entries ?? [];
  const sessionId = options.sessionId ?? "session-1";
  const selectedModels: unknown[] = [];
  const thinkingLevels: string[] = [];
  const activeToolSets: string[][] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notifications: Array<[string, string]> = [];

  const pi = {
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
    getActiveTools: () => [...activeTools],
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    },
    registerCommand: (name: string, command: { handler: ToggleHandler }) => {
      if (name === "plan") toggle = command.handler;
    },
    registerShortcut: () => undefined,
    setActiveTools: (tools: string[]) => {
      activeTools = [...tools];
      activeToolSets.push([...tools]);
    },
    setModel: async (model: unknown) => {
      selectedModels.push(model);
      return true;
    },
    setThinkingLevel: (level: string) => thinkingLevels.push(level),
  } as unknown as ExtensionAPI;
  const ctx = {
    isIdle: () => idle,
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
      getHeader: () => ({ id: sessionId }),
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
    setIdle(value: boolean) {
      idle = value;
    },
    selectModel(model: { provider: string; id: string }) {
      void handlers.get("model_select")?.({ model, source: "set" } as never, ctx);
    },
    async startSession(reason: "new" | "reload" | "resume") {
      await handlers.get("session_start")?.({ reason } as never, ctx);
    },
    statuses,
    thinkingLevels,
    async toggle() {
      if (toggle === undefined) throw new Error("Plan command was not registered");
      await toggle("", ctx);
    },
  };
}

describe("plan mode", () => {
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

  test("leaving restores the exact prior tools and configured build model and thinking level", async () => {
    const originalTools = ["read", "write", "custom", "exec", "read"];
    const harness = createHarness({ activeTools: originalTools });

    await harness.toggle();
    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel, buildModel]);
    expect(harness.thinkingLevels).toEqual(["high", "xhigh"]);
    expect(harness.activeTools).toEqual(originalTools);
    expect(harness.activeToolSets).toEqual([["read", "read"], originalTools]);
    expect(harness.statuses).toEqual([
      ["plan-mode", PLAN_MODE_STATUS],
      ["plan-mode", undefined],
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

  test.each(["reload", "resume"] as const)(
    "restores build and plan model overrides after %s",
    async (reason) => {
      const entries: PersistedEntry[] = [];
      const initial = createHarness({
        activeTools: ["read", "write"],
        entries,
        sessionId: "session-a",
      });

      initial.selectModel(alternateBuildModel);
      await initial.toggle();
      initial.selectModel(alternatePlanModel);

      const restored = createHarness({
        activeTools: ["read", "write"],
        entries,
        sessionId: "session-a",
      });
      await restored.startSession(reason);
      await restored.toggle();

      expect(restored.selectedModels).toEqual([alternateBuildModel, alternatePlanModel]);
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
});
