import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PLAN_MODE_STATUS = "Plan";

const MODE_MODELS_ENTRY_TYPE = "plan-mode-models";
const MODE_TRANSITION_MESSAGE_TYPE = "plan-mode-transition";
const CONFIG_URL = new URL("../modes.json", import.meta.url);
const PLAN_READ_ONLY_TOOLS = new Set([
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
  "mcp__context7",
]);
const PLAN_READ_ONLY_TOOL_PREFIXES = ["context7_", "mcp__context7_", "ast-grep_"] as const;

// Child sessions receive their own agent tool list, so track active parent plan sessions explicitly.
const PLAN_MODE_SESSION_FILES = new Set<string>();
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

interface PersistedModeState {
  sessionId: string;
  models: Partial<Record<ModeName, string>>;
  thinkingLevels?: Partial<Record<ModeName, ThinkingLevel>>;
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

function getSessionFile(ctx: ExtensionContext): string | undefined {
  const sessionFile = ctx.sessionManager.getSessionFile();
  return typeof sessionFile === "string" && sessionFile.length > 0 ? sessionFile : undefined;
}

function isParentInPlanMode(ctx: ExtensionContext): boolean {
  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  return typeof parentSession === "string" && PLAN_MODE_SESSION_FILES.has(parentSession);
}

function setPlanModeSession(ctx: ExtensionContext, enabled: boolean): void {
  const sessionFile = getSessionFile(ctx);
  if (sessionFile === undefined) return;

  if (enabled) {
    PLAN_MODE_SESSION_FILES.add(sessionFile);
  } else {
    PLAN_MODE_SESSION_FILES.delete(sessionFile);
  }
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isPlanReadOnlyTool(name: string, configuredAllowedTools: ReadonlySet<string>): boolean {
  return (
    configuredAllowedTools.has(name) ||
    PLAN_READ_ONLY_TOOLS.has(name) ||
    PLAN_READ_ONLY_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
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
  let inheritedPlanMode = false;
  let selectingModeModel = false;
  let switchingMode = false;
  let toolsBeforePlanMode: string[] | undefined;
  const configuredModeModels: Record<ModeName, string> = {
    build: MODES.build.model,
    plan: MODES.plan.model,
  };
  const modeModelOverrides: Partial<Record<ModeName, string>> = {};

  const modeThinkingLevels: Record<ModeName, ThinkingLevel> = {
    build: MODES.build.thinkingLevel,
    plan: MODES.plan.thinkingLevel,
  };

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

      if (isRecord(entry.data.models)) {
        for (const name of ["build", "plan"] as const) {
          const model = entry.data.models[name];
          if (isModelReference(model)) modeModelOverrides[name] = model;
        }
      }

      if (isRecord(entry.data.thinkingLevels)) {
        for (const name of ["build", "plan"] as const) {
          const thinkingLevel = entry.data.thinkingLevels[name];
          if (isThinkingLevel(thinkingLevel)) modeThinkingLevels[name] = thinkingLevel;
        }
      }
    }
  }

  function persistModeModels(ctx: ExtensionContext): void {
    const sessionId = ctx.sessionManager.getHeader()?.id;
    if (sessionId === undefined) return;

    pi.appendEntry<PersistedModeState>(MODE_MODELS_ENTRY_TYPE, {
      sessionId,
      models: { ...modeModelOverrides },
      thinkingLevels: { ...modeThinkingLevels },
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus("plan-mode", enabled ? PLAN_MODE_STATUS : undefined);
  }

  function getPlanModeTools(activeTools: readonly string[]): string[] {
    const availablePlanTools = pi
      .getAllTools()
      .map((tool) => tool.name)
      .filter((name) => isPlanReadOnlyTool(name, MODES.plan.allowedTools));

    return [...new Set([...activeTools, ...availablePlanTools])].filter((name) =>
      isPlanReadOnlyTool(name, MODES.plan.allowedTools),
    );
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
    if (switchingMode) return;

    if (ctx.isIdle() === false) {
      ctx.ui.notify("Wait for the current response to finish before switching modes.", "warning");
      return;
    }

    switchingMode = true;
    try {
      refreshModeModels();

      if (enabled) {
        if ((await selectModeModel("build", ctx)) === false) return;

        // Build mode must not lose the read-only tools that plan mode loaded.
        const toolsRestored = toolsBeforePlanMode ?? pi.getActiveTools();
        const toolsLoadedByPlan = pi
          .getActiveTools()
          .filter((name) => !toolsRestored.includes(name));
        pi.setActiveTools([...toolsRestored, ...toolsLoadedByPlan]);
        setPlanModeSession(ctx, false);
        toolsBeforePlanMode = undefined;
        enabled = false;
        updateStatus(ctx);
        pi.setThinkingLevel(modeThinkingLevels.build);
        // Queue the handoff for the next user turn instead of triggering an unsolicited response.
        pi.sendMessage(
          {
            customType: MODE_TRANSITION_MESSAGE_TYPE,
            content:
              "Plan mode is now disabled. You are in build mode. The tools active before plan mode and its read-only tools are available. Implement the user's request instead of producing another plan.",
            display: false,
          },
          { deliverAs: "nextTurn" },
        );
        return;
      }

      if ((await selectModeModel("plan", ctx)) === false) return;

      const activeTools = pi.getActiveTools();
      toolsBeforePlanMode = activeTools;
      pi.setActiveTools(getPlanModeTools(activeTools));
      setPlanModeSession(ctx, true);
      enabled = true;
      updateStatus(ctx);
      pi.setThinkingLevel(modeThinkingLevels.plan);
    } finally {
      switchingMode = false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    childSession = isSubagentSession(ctx);
    setPlanModeSession(ctx, false);
    if (childSession) {
      inheritedPlanMode = isParentInPlanMode(ctx);
      if (inheritedPlanMode) {
        setPlanModeSession(ctx, true);
        pi.setActiveTools(getPlanModeTools(pi.getActiveTools()));
      }
      return;
    }

    restoreModeModels(ctx);
    if ((await selectModeModel("build", ctx)) === false) return;

    pi.setThinkingLevel(modeThinkingLevels.build);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    setPlanModeSession(ctx, false);
  });

  pi.on("model_select", (event, ctx) => {
    if (childSession || isSubagentSession(ctx)) return;
    if (selectingModeModel || event.source === "restore") return;

    const mode: ModeName = enabled ? "plan" : "build";
    modeModelOverrides[mode] = `${event.model.provider}/${event.model.id}`;
    modeThinkingLevels[mode] = "minimal";
    pi.setThinkingLevel(modeThinkingLevels[mode]);
    modeThinkingLevels[mode] = pi.getThinkingLevel();
    persistModeModels(ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (childSession || isSubagentSession(ctx)) return;
    if (selectingModeModel) return;

    const mode: ModeName = enabled ? "plan" : "build";
    modeThinkingLevels[mode] = event.level;
    persistModeModels(ctx);
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
    const child = childSession || isSubagentSession(ctx, event.systemPrompt);
    if (child) {
      if (inheritedPlanMode === false) return;
      return {
        systemPrompt: `${event.systemPrompt}\n\n${MODE_PROMPTS.plan}`,
      };
    }

    const modePrompt = MODE_PROMPTS[enabled ? "plan" : "build"];

    return {
      systemPrompt: `${event.systemPrompt}\n\n${modePrompt}`,
    };
  });
}
