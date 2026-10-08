import { describe, expect, test } from "bun:test";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { setCapabilities } from "@earendil-works/pi-tui";
import { normalizeBuildSystemPromptOptions } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { registerChartGuidance } from "../prompt";

type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
) => BeforeAgentStartEventResult | undefined;

function createHandler(toolNames: readonly string[]): BeforeAgentStartHandler {
  let handler: BeforeAgentStartHandler | undefined;
  const pi = {
    getAllTools: () => toolNames.map((name) => ({ name })),
    on(event: string, candidate: BeforeAgentStartHandler) {
      if (event === "before_agent_start") handler = candidate;
    },
  } as unknown as ExtensionAPI;
  registerChartGuidance(pi);
  if (handler === undefined) throw new Error("chart prompt handler was not registered");
  return handler;
}

function createEvent(): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt: "Show a chart",
    systemPrompt: "base prompt",
    systemPromptOptions: normalizeBuildSystemPromptOptions({
      cwd: "/tmp",
      sections: { other: "Keep this section." },
    }),
  } as BeforeAgentStartEvent;
}

const tuiContext = { mode: "tui", hasUI: true } as ExtensionContext;

function setImageCapability(images: "kitty" | "iterm2" | null): void {
  setCapabilities({ images, trueColor: true, hyperlinks: true });
}

describe("chart prompt guidance", () => {
  test("mentions deferred charts when an available chart tool can render in the TUI", () => {
    setImageCapability("kitty");
    const event = createEvent();
    expect(createHandler(["read", "chart_gantt"])(event, tuiContext)).toBeUndefined();
    const guidance = event.systemPromptOptions.sections?.chart_visuals;
    expect(guidance).toContain("timelines");
    expect(guidance).toContain("tool_search");
    expect(guidance).toContain("tool_load");
    expect(guidance).toContain("12 nodes");
    expect(guidance).toContain("32 nodes");
    expect(guidance).toContain("balanced values");
    expect(guidance).toContain("chart_");
    expect(guidance).not.toContain("chart_gantt");
    expect(event.systemPromptOptions.sections?.other).toBe("Keep this section.");
    expect(event.systemPromptOptions.forceSystemPrompt).toBeUndefined();
  });

  test.each([
    { mode: "print" as const, hasUI: true, images: "kitty" as const },
    { mode: "tui" as const, hasUI: false, images: "kitty" as const },
    { mode: "tui" as const, hasUI: true, images: null },
  ])("does not inject guidance without inline TUI images", (context) => {
    setImageCapability(context.images);
    const result = createHandler(["chart_gantt"])(createEvent(), {
      ...tuiContext,
      mode: context.mode,
      hasUI: context.hasUI,
    });

    expect(result).toBeUndefined();
  });

  test("does not inject guidance when chart tools are unavailable", () => {
    setImageCapability("iterm2");

    expect(createHandler(["read"])(createEvent(), tuiContext)).toBeUndefined();
  });

  test("updates only its own section without duplicating guidance", () => {
    setImageCapability("kitty");
    const event = createEvent();
    const handler = createHandler(["chart_gantt"]);
    handler(event, tuiContext);
    const sections = { ...event.systemPromptOptions.sections };
    handler(event, tuiContext);
    expect(event.systemPromptOptions.sections).toEqual(sections);
    expect(event.systemPromptOptions.forceSystemPrompt).toBeUndefined();

    setImageCapability(null);
    handler(event, tuiContext);
    expect(event.systemPromptOptions.sections?.chart_visuals).toBe("");
    expect(event.systemPromptOptions.sections?.other).toBe("Keep this section.");
  });
});
