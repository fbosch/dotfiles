import { describe, expect, test } from "bun:test";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { setCapabilities } from "@earendil-works/pi-tui";
import {
  appendChartGuidance,
  CHART_GUIDANCE_END,
  CHART_GUIDANCE_START,
  registerChartGuidance,
} from "../prompt";

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

const event = {
  type: "before_agent_start",
  prompt: "Show a chart",
  systemPrompt: "base prompt",
  systemPromptOptions: {},
} as BeforeAgentStartEvent;

const tuiContext = { mode: "tui", hasUI: true } as ExtensionContext;

function setImageCapability(images: "kitty" | "iterm2" | null): void {
  setCapabilities({ images, trueColor: true, hyperlinks: true });
}

describe("chart prompt guidance", () => {
  test("mentions deferred charts when an available chart tool can render in the TUI", () => {
    setImageCapability("kitty");
    const result = createHandler(["read", "chart_gantt"])(event, tuiContext);
    expect(result?.systemPrompt).toContain(CHART_GUIDANCE_START);
    expect(result?.systemPrompt).toContain("timelines");
    expect(result?.systemPrompt).toContain("search_tools");
    expect(result?.systemPrompt).toContain("chart_");
    expect(result?.systemPrompt).not.toContain("chart_gantt");
    expect(result?.systemPrompt).toContain(CHART_GUIDANCE_END);
  });

  test.each([
    { mode: "print" as const, hasUI: true, images: "kitty" as const },
    { mode: "tui" as const, hasUI: false, images: "kitty" as const },
    { mode: "tui" as const, hasUI: true, images: null },
  ])("does not inject guidance without inline TUI images", (context) => {
    setImageCapability(context.images);
    const result = createHandler(["chart_gantt"])(event, {
      ...tuiContext,
      mode: context.mode,
      hasUI: context.hasUI,
    });

    expect(result).toBeUndefined();
  });

  test("does not inject guidance when chart tools are unavailable", () => {
    setImageCapability("iterm2");

    expect(createHandler(["read"])(event, tuiContext)).toBeUndefined();
  });

  test("replaces its own marked block without duplicating it", () => {
    const first = appendChartGuidance("base prompt");
    const second = appendChartGuidance(`${first}\n\nAfter prompt.`);

    expect(second.match(new RegExp(CHART_GUIDANCE_START, "g"))).toHaveLength(1);
    expect(second.match(new RegExp(CHART_GUIDANCE_END, "g"))).toHaveLength(1);
    expect(second).toContain("After prompt.");
  });
});
