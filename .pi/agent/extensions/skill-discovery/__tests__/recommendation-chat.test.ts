import { describe, expect, test } from "bun:test";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  createEventBus,
  type EntryRenderer,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSkillSelectionExtension, type SkillSelectionAttempt } from "../selection";

type RecommendationData = { skills: string[] };

function harness(attempt: SkillSelectionAttempt) {
  const entries: { customType: string; data: unknown }[] = [];
  let handler:
    | ((
        event: BeforeAgentStartEvent,
        context: ExtensionContext,
      ) =>
        | Promise<BeforeAgentStartEventResult | undefined>
        | BeforeAgentStartEventResult
        | undefined)
    | undefined;
  let renderer: EntryRenderer<RecommendationData> | undefined;
  createSkillSelectionExtension({
    getConfig: () => ({ enabled: true, threshold: 0.72, timeoutMs: 2400, maxRecommendations: 3 }),
    getDisabledNames: () => new Set(),
    selectSkillsDetailed: async () => attempt,
  })({
    events: createEventBus(),
    registerCommand: () => {},
    registerEntryRenderer: (customType: string, callback: EntryRenderer<RecommendationData>) => {
      expect(customType).toBe("skill-recommendations");
      renderer = callback;
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    on: (_event: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as ExtensionAPI);
  if (!handler || !renderer) throw new Error("Recommendation hooks were not registered");
  const event = {
    prompt: "Help with tests",
    systemPrompt: "Original instructions",
    systemPromptOptions: {
      sections: {},
      skills: ["bun", "æøå"].map((name) => ({
        name,
        description: "Workflow",
        filePath: `/skills/${name}/SKILL.md`,
        disableModelInvocation: false,
      })),
    },
  } as unknown as BeforeAgentStartEvent;
  const context = {
    cwd: "/tmp",
    hasUI: true,
    sessionManager: {
      getBranch: () => [],
      buildSessionProjection: () => ({ entries: [], messages: [], thinkingLevel: "", model: null }),
    },
  } as unknown as ExtensionContext;
  return { entries, handler, renderer, event, context };
}

describe("recommendation chat entries", () => {
  test("displays actual skill names without changing model hints or loading skills", async () => {
    const { entries, handler, renderer, event, context } = harness({
      ok: true,
      value: {
        recommendations: [
          { name: "bun", score: 0.95 },
          { name: "æøå", score: 0.9 },
        ],
        scores: new Map(),
        noMatchScore: 0,
      },
    });
    const result = await handler(event, context);
    expect(result).toMatchObject({
      message: {
        customType: "skill-recommendation-advice",
        display: false,
        content: expect.stringContaining('description="Workflow"'),
      },
    });
    expect(entries).toEqual([
      { customType: "skill-recommendations", data: { skills: ["bun", "æøå"] } },
    ]);
    expect(event.systemPrompt).toBe("Original instructions");
    expect(event.systemPromptOptions.sections).toEqual({});
    const component = renderer(
      {
        type: "custom",
        id: "chat",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "skill-recommendations",
        data: { skills: ["bun", "æøå"] },
      },
      { expanded: false },
      {
        fg: (_color: string, text: string) => text,
      } as Parameters<typeof renderer>[2],
    );
    expect(component?.render(120).join("\n").trimEnd()).toBe("Recommended skills: bun, æøå");
    expect(component?.render(12).every((line) => visibleWidth(line) <= 12)).toBe(true);
  });

  const emptyAttempts: SkillSelectionAttempt[] = [
    { ok: true, value: { recommendations: [], scores: new Map(), noMatchScore: 1 } },
    {
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    },
    {
      ok: false,
      failure: { kind: "classifier-failure", stage: "request", reason: "request-failure" },
    },
  ];
  test.each(emptyAttempts)(
    "does not append chat output for no matches or failures (%#)",
    async (attempt) => {
      const { entries, handler, event, context } = harness(attempt);
      await handler(event, context);
      expect(entries).toEqual([]);
      expect(event.systemPromptOptions.sections).toEqual({});
    },
  );
});
