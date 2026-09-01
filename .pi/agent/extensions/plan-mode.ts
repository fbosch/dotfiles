import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PLAN_MODE_STATUS = "Plan";

const PLAN_MODE_TOOLS = new Set(["read", "find", "grep", "ls", "skill", "fffind", "ffgrep"]);
const CONFIG_URL = new URL("../modes.json", import.meta.url);

type ModeName = "build" | "plan";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface ModeConfig {
  model: string;
  prompt: string;
  thinkingLevel: ThinkingLevel;
}

const THINKING_LEVELS: ReadonlySet<string> = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value);
}

function loadModeConfig(name: ModeName, value: unknown): ModeConfig {
  if (isRecord(value) === false) {
    throw new Error(`Mode config must be an object: ${name}`);
  }

  const { model, prompt, thinkingLevel } = value;

  if (typeof model !== "string") {
    throw new Error(`Mode model must use provider/model format: ${name}.model`);
  }

  const modelSeparator = model.indexOf("/");
  if (modelSeparator <= 0 || modelSeparator === model.length - 1) {
    throw new Error(`Mode model must use provider/model format: ${name}.model`);
  }

  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Mode prompt path must be a non-empty string: ${name}.prompt`);
  }

  if (isThinkingLevel(thinkingLevel) === false) {
    throw new Error(`Invalid thinking level: ${name}.thinkingLevel`);
  }

  return { model, prompt, thinkingLevel };
}

function loadModes(): Record<ModeName, ModeConfig> {
  const config: unknown = JSON.parse(readFileSync(CONFIG_URL, "utf8"));

  if (isRecord(config) === false) {
    throw new Error("Mode config must be an object");
  }

  return {
    build: loadModeConfig("build", config.build),
    plan: loadModeConfig("plan", config.plan),
  };
}

function loadPrompt(path: string): string {
  const prompt = readFileSync(new URL(path, CONFIG_URL), "utf8").trim();

  if (prompt.length === 0) {
    throw new Error(`Mode prompt is empty: ${path}`);
  }

  return prompt;
}

function parseModel(value: string): [provider: string, model: string] {
  const separator = value.indexOf("/");
  return [value.slice(0, separator), value.slice(separator + 1)];
}

const MODES = loadModes();
const MODE_PROMPTS: Record<ModeName, string> = {
  build: loadPrompt(MODES.build.prompt),
  plan: loadPrompt(MODES.plan.prompt),
};

export default function planMode(pi: ExtensionAPI): void {
  let enabled = false;
  let selectingModeModel = false;
  let toolsBeforePlanMode: string[] | undefined;
  const modeModels: Record<ModeName, string> = {
    build: MODES.build.model,
    plan: MODES.plan.model,
  };
  const modeThinkingLevels: Record<ModeName, ThinkingLevel> = {
    build: MODES.build.thinkingLevel,
    plan: MODES.plan.thinkingLevel,
  };

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus("plan-mode", enabled ? PLAN_MODE_STATUS : undefined);
  }

  async function selectModeModel(name: ModeName, ctx: ExtensionContext): Promise<boolean> {
    const modelReference = modeModels[name];
    const [provider, modelId] = parseModel(modelReference);
    const model = ctx.modelRegistry.find(provider, modelId);

    if (model === undefined) {
      ctx.ui.notify(`Configured ${name} model is unavailable: ${modelReference}`, "error");
      return false;
    }

    selectingModeModel = true;
    try {
      if ((await pi.setModel(model)) === false) {
        ctx.ui.notify(`No authentication available for ${name} model: ${modelReference}`, "error");
        return false;
      }
    } finally {
      selectingModeModel = false;
    }

    return true;
  }

  async function toggle(ctx: ExtensionContext): Promise<void> {
    if (ctx.isIdle() === false) {
      ctx.ui.notify("Wait for the current response to finish before switching modes.", "warning");
      return;
    }

    if (enabled) {
      if ((await selectModeModel("build", ctx)) === false) return;

      pi.setActiveTools(toolsBeforePlanMode ?? pi.getActiveTools());
      toolsBeforePlanMode = undefined;
      enabled = false;
      updateStatus(ctx);
      pi.setThinkingLevel(modeThinkingLevels.build);
      return;
    }

    if ((await selectModeModel("plan", ctx)) === false) return;

    toolsBeforePlanMode = pi.getActiveTools();
    pi.setActiveTools(toolsBeforePlanMode.filter((name) => PLAN_MODE_TOOLS.has(name)));
    enabled = true;
    updateStatus(ctx);
    pi.setThinkingLevel(modeThinkingLevels.plan);
  }

  pi.on("session_start", async (_event, ctx) => {
    if ((await selectModeModel("build", ctx)) === false) return;

    pi.setThinkingLevel(modeThinkingLevels.build);
  });

  pi.on("model_select", (event) => {
    if (selectingModeModel) return;

    const mode: ModeName = enabled ? "plan" : "build";
    modeModels[mode] = `${event.model.provider}/${event.model.id}`;
  });

  pi.on("thinking_level_select", (event) => {
    if (selectingModeModel) return;

    const mode: ModeName = enabled ? "plan" : "build";
    modeThinkingLevels[mode] = event.level;
  });

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    handler: async (_args, ctx) => toggle(ctx),
  });

  pi.registerShortcut("tab", {
    description: "Toggle plan mode",
    handler: async (ctx) => toggle(ctx),
  });

  pi.on("before_agent_start", async (event) => {
    const modePrompt = MODE_PROMPTS[enabled ? "plan" : "build"];

    return {
      systemPrompt: `${event.systemPrompt}\n\n${modePrompt}`,
    };
  });
}
