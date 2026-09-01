import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PLAN_MODE_STATUS = "Plan";

const PLAN_MODE_TOOLS = new Set(["read", "find", "grep", "ls", "skill", "fffind", "ffgrep"]);

function loadPrompt(filename: string): string {
  const prompt = readFileSync(new URL(`../prompts/${filename}`, import.meta.url), "utf8").trim();

  if (prompt.length === 0) {
    throw new Error(`Mode prompt is empty: ${filename}`);
  }

  return prompt;
}

const BUILD_MODE_PROMPT = loadPrompt("build.txt");
const PLAN_MODE_PROMPT = loadPrompt("plan.txt");

export default function planMode(pi: ExtensionAPI): void {
  let enabled = false;
  let toolsBeforePlanMode: string[] | undefined;

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus("plan-mode", enabled ? PLAN_MODE_STATUS : undefined);
  }

  function toggle(ctx: ExtensionContext): void {
    if (ctx.isIdle() === false) {
      ctx.ui.notify("Wait for the current response to finish before switching modes.", "warning");
      return;
    }

    if (enabled) {
      pi.setActiveTools(toolsBeforePlanMode ?? pi.getActiveTools());
      toolsBeforePlanMode = undefined;
      enabled = false;
      updateStatus(ctx);
      return;
    }

    toolsBeforePlanMode = pi.getActiveTools();
    pi.setActiveTools(toolsBeforePlanMode.filter((name) => PLAN_MODE_TOOLS.has(name)));
    enabled = true;
    updateStatus(ctx);
  }

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    handler: async (_args, ctx) => toggle(ctx),
  });

  pi.registerShortcut("tab", {
    description: "Toggle plan mode",
    handler: async (ctx) => toggle(ctx),
  });

  pi.on("before_agent_start", async (event) => {
    const modePrompt = enabled ? PLAN_MODE_PROMPT : BUILD_MODE_PROMPT;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${modePrompt}`,
    };
  });
}
