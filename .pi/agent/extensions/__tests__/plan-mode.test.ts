import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import planMode, { PLAN_MODE_STATUS } from "../plan-mode";

type ToggleHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

const buildModel = { provider: "openai-codex", id: "gpt-5.6-luna" };
const planModel = { provider: "openai-codex", id: "gpt-5.6-sol" };

function createHarness(options: { activeTools: string[]; idle?: boolean; planModelAvailable?: boolean }) {
  let activeTools = [...options.activeTools];
  let idle = options.idle ?? true;
  let toggle: ToggleHandler | undefined;
  const selectedModels: unknown[] = [];
  const thinkingLevels: string[] = [];
  const activeToolSets: string[][] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notifications: Array<[string, string]> = [];

  const pi = {
    getActiveTools: () => [...activeTools],
    on: () => undefined,
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

        return provider === buildModel.provider && id === buildModel.id ? buildModel : undefined;
      },
    },
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
    },
  } as unknown as ExtensionContext;

  planMode(pi);

  return {
    get activeTools() {
      return activeTools;
    },
    activeToolSets,
    notifications,
    selectedModels,
    setIdle(value: boolean) {
      idle = value;
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
        "custom",
      ],
    });

    await harness.toggle();

    expect(harness.selectedModels).toEqual([planModel]);
    expect(harness.thinkingLevels).toEqual(["high"]);
    expect(harness.activeTools).toEqual(["read", "find", "grep", "ls", "skill", "fffind", "ffgrep"]);
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
    expect(harness.activeToolSets).toEqual([
      ["read", "read"],
      originalTools,
    ]);
    expect(harness.statuses).toEqual([
      ["plan-mode", PLAN_MODE_STATUS],
      ["plan-mode", undefined],
    ]);
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
    expect(harness.notifications).toEqual([["Wait for the current response to finish before switching modes.", "warning"]]);

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
