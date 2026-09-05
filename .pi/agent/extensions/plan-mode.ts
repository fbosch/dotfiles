import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PLAN_MODE_STATUS = "Plan";

const MODE_MODELS_ENTRY_TYPE = "plan-mode-models";
const CONFIG_URL = new URL("../modes.json", import.meta.url);

export type ModeName = "build" | "plan";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface ModeConfig {
  model: string;
  prompt: string;
  thinkingLevel: ThinkingLevel;
  color: string;
}

interface PlanModeConfig extends ModeConfig {
  allowedTools: ReadonlySet<string>;
}

interface ModesConfig {
  build: ModeConfig;
  plan: PlanModeConfig;
}

interface PersistedModeModels {
  sessionId: string;
  models: Partial<Record<ModeName, string>>;
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

const ACTIVE_AGENT_MARKER = /^<active_agent\s+name=(?:"[^"\r\n]+"|'[^'\r\n]+')[^>]*\/>\s*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSubagentSession(ctx: ExtensionContext, systemPrompt = ctx.getSystemPrompt()): boolean {
  // pi-subagents supplies both signals: its documented active-agent marker and
  // the parent-session header. Requiring both avoids treating a normal fork or
  // prompt text that merely quotes the marker as a child session.
  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  if (typeof parentSession !== "string" || parentSession.length === 0) return false;

  return systemPrompt.split("\n").some((line) => ACTIVE_AGENT_MARKER.test(line));
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isModelReference(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1;
}

function loadModeConfig(name: ModeName, value: Record<string, unknown>): ModeConfig {
  const { model, prompt, thinkingLevel, color } = value;

  if (isModelReference(model) === false) {
    throw new Error(`Mode model must use provider/model format: ${name}.model`);
  }

  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Mode prompt path must be a non-empty string: ${name}.prompt`);
  }

  if (isThinkingLevel(thinkingLevel) === false) {
    throw new Error(`Invalid thinking level: ${name}.thinkingLevel`);
  }

  if (isHexColor(color) === false) {
    throw new Error(`Mode color must be a six-digit hex color: ${name}.color`);
  }

  return { model, prompt, thinkingLevel, color };
}

function loadModeObject(name: ModeName, value: unknown): Record<string, unknown> {
  if (isRecord(value) === false) {
    throw new Error(`Mode config must be an object: ${name}`);
  }

  return value;
}

function loadAllowedTools(value: unknown): ReadonlySet<string> {
  if (Array.isArray(value) === false || value.length === 0) {
    throw new Error("Mode allowed tools must be a non-empty array: plan.allowedTools");
  }

  const tools = value.map((tool) => {
    if (typeof tool !== "string" || tool.length === 0 || tool.trim() !== tool) {
      throw new Error("Mode tool names must be non-empty strings: plan.allowedTools");
    }

    return tool;
  });
  const allowedTools = new Set(tools);

  if (allowedTools.size !== tools.length) {
    throw new Error("Mode tool names must be unique: plan.allowedTools");
  }

  return allowedTools;
}

function loadModes(): ModesConfig {
  const config: unknown = JSON.parse(readFileSync(CONFIG_URL, "utf8"));

  if (isRecord(config) === false) {
    throw new Error("Mode config must be an object");
  }

  const build = loadModeObject("build", config.build);
  const plan = loadModeObject("plan", config.plan);

  return {
    build: loadModeConfig("build", build),
    plan: {
      ...loadModeConfig("plan", plan),
      allowedTools: loadAllowedTools(plan.allowedTools),
    },
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
type ModeConfigLoader = () => ModesConfig;

const MODE_PROMPTS: Record<ModeName, string> = {
  build: loadPrompt(MODES.build.prompt),
  plan: loadPrompt(MODES.plan.prompt),
};

export function getModeColor(name: ModeName): string {
  return MODES[name].color;
}

export default function planMode(pi: ExtensionAPI, readModes: ModeConfigLoader = loadModes): void {
  let enabled = false;
  let childSession = false;
  let selectingModeModel = false;
  let toolsBeforePlanMode: string[] | undefined;
  const configuredModeModels: Record<ModeName, string> = {
    build: MODES.build.model,
    plan: MODES.plan.model,
  };
  const modeModelOverrides: Partial<Record<ModeName, string>> = {};

  function refreshModeModels(): void {
    const modes = readModes();
    configuredModeModels.build = modes.build.model;
    configuredModeModels.plan = modes.plan.model;
  }

  function restoreModeModels(ctx: ExtensionContext): void {
    const sessionId = ctx.sessionManager.getHeader()?.id;
    if (sessionId === undefined) return;

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== MODE_MODELS_ENTRY_TYPE) continue;
      // Forks copy custom entries, so restore only state owned by the current session header.
      if (isRecord(entry.data) === false || entry.data.sessionId !== sessionId) continue;
      if (isRecord(entry.data.models) === false) continue;

      for (const name of ["build", "plan"] as const) {
        const model = entry.data.models[name];
        if (isModelReference(model)) modeModelOverrides[name] = model;
      }
    }
  }

  function persistModeModels(ctx: ExtensionContext): void {
    const sessionId = ctx.sessionManager.getHeader()?.id;
    if (sessionId === undefined) return;

    pi.appendEntry<PersistedModeModels>(MODE_MODELS_ENTRY_TYPE, {
      sessionId,
      models: { ...modeModelOverrides },
    });
  }
  const modeThinkingLevels: Record<ModeName, ThinkingLevel> = {
    build: MODES.build.thinkingLevel,
    plan: MODES.plan.thinkingLevel,
  };

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus("plan-mode", enabled ? PLAN_MODE_STATUS : undefined);
  }

  async function selectModeModel(name: ModeName, ctx: ExtensionContext): Promise<boolean> {
    const modelReference = modeModelOverrides[name] ?? configuredModeModels[name];
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
    if (childSession || isSubagentSession(ctx)) return;

    if (ctx.isIdle() === false) {
      ctx.ui.notify("Wait for the current response to finish before switching modes.", "warning");
      return;
    }

    refreshModeModels();

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
    pi.setActiveTools(toolsBeforePlanMode.filter((name) => MODES.plan.allowedTools.has(name)));
    enabled = true;
    updateStatus(ctx);
    pi.setThinkingLevel(modeThinkingLevels.plan);
  }

  pi.on("session_start", async (_event, ctx) => {
    childSession = isSubagentSession(ctx);
    if (childSession) return;

    restoreModeModels(ctx);
    if ((await selectModeModel("build", ctx)) === false) return;

    pi.setThinkingLevel(modeThinkingLevels.build);
  });

  pi.on("model_select", (event, ctx) => {
    if (childSession || isSubagentSession(ctx)) return;
    if (selectingModeModel || event.source === "restore") return;

    const mode: ModeName = enabled ? "plan" : "build";
    modeModelOverrides[mode] = `${event.model.provider}/${event.model.id}`;
    persistModeModels(ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (childSession || isSubagentSession(ctx)) return;
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

  pi.on("before_agent_start", async (event, ctx) => {
    if (childSession || isSubagentSession(ctx, event.systemPrompt)) return;

    const modePrompt = MODE_PROMPTS[enabled ? "plan" : "build"];

    return {
      systemPrompt: `${event.systemPrompt}\n\n${modePrompt}`,
    };
  });
}
