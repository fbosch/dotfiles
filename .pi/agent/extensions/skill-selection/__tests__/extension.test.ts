import { describe, expect, test } from "bun:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  Skill,
} from "@earendil-works/pi-coding-agent";
import {
  createSkillSelectionExtension,
  createSkillSelectionRequest,
  DEFAULT_SKILL_SELECTION_CONFIG,
  eligibleSkillCandidates,
  formatSkillRecommendations,
  parseSkillSelectionResponse,
  parseSkillSelectionResponseDetailed,
  resolveSkillSelectionConfig,
  type SkillSelectionResult,
  selectSkillsWithJev,
  selectSkillsWithJevDetailed,
} from "../index";

function skill(
  name: string,
  options: Partial<Pick<Skill, "description" | "disableModelInvocation">> = {},
): Skill {
  return {
    name,
    description: options.description ?? `${name} description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation: options.disableModelInvocation ?? false,
  };
}

function extensionHarness(dependencies: Parameters<typeof createSkillSelectionExtension>[0] = {}) {
  let handler:
    | ((event: BeforeAgentStartEvent, context: ExtensionContext) => Promise<unknown> | unknown)
    | undefined;
  const extension = createSkillSelectionExtension(dependencies);
  const api = {
    on: (_event: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as ExtensionAPI;
  extension(api);
  if (handler === undefined) throw new Error("extension did not register a handler");
  return handler;
}

function context(): ExtensionContext {
  return {
    cwd: "/tmp/skill-selection-test",
    hasUI: false,
    isProjectTrusted: () => true,
    modelRegistry: {
      getProviderAuth: async () => undefined,
    },
  } as unknown as ExtensionContext;
}

function event(prompt = "Help me choose an approach") {
  return {
    prompt,
    systemPrompt: "default instructions\n\n<available_skills>catalog</available_skills>",
    systemPromptOptions: {
      skills: [
        skill("writing-clearly", { description: "Improve documentation prose." }),
        skill("hidden-workflow", {
          description: "Private workflow.",
          disableModelInvocation: true,
        }),
        skill("security-and-hardening", { description: "Threat-model untrusted input." }),
      ],
    },
  } as unknown as BeforeAgentStartEvent;
}

const ENABLED_CONFIG = { ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: true };

function scores(values: Record<string, number>): SkillSelectionResult {
  const recommendations = Object.entries(values)
    .filter(([, score]) => score >= DEFAULT_SKILL_SELECTION_CONFIG.threshold)
    .map(([name, score]) => ({ name, score }));
  return {
    recommendations,
    scores: new Map(Object.entries(values)),
  };
}

describe("skill selection", () => {
  test("keeps only model-invocable and non-denied skills, independent of catalog order", () => {
    const candidates = eligibleSkillCandidates(
      [skill("zeta"), skill("hidden", { disableModelInvocation: true }), skill("alpha")],
      new Set(["zeta"]),
    );

    expect(candidates).toEqual([{ name: "alpha", description: "alpha description" }]);
  });

  test("builds independent relevance questions without skill bodies or denial metadata", () => {
    const request = createSkillSelectionRequest("Write a concise guide", [
      { name: "writing-clearly", description: "Improve documentation prose." },
      { name: "security-and-hardening", description: "Threat-model untrusted input." },
    ]);

    expect(request).toEqual(
      expect.objectContaining({
        state: {
          request: "Write a concise guide",
          skills: [
            {
              id: "skill_0",
              name: "security-and-hardening",
              description: "Threat-model untrusted input.",
            },
            { id: "skill_1", name: "writing-clearly", description: "Improve documentation prose." },
          ],
        },
      }),
    );
    const questions = (request as { questions: Record<string, { type: string }> }).questions;
    expect(questions.skill_0?.type).toBe("noul");
    expect(questions.skill_1?.type).toBe("noul");
    expect(questions.none_relevant?.type).toBe("noul");
    expect(JSON.stringify(request)).not.toContain("SKILL.md");
  });

  test("supports zero and multiple recommendations with deterministic ordering and cap", () => {
    const candidates = [
      { name: "writing-clearly", description: "writing" },
      { name: "security-and-hardening", description: "security" },
      { name: "bun", description: "bun" },
    ];

    expect(
      parseSkillSelectionResponse(
        {
          answers: {
            skill_0: { type: "noul", noul: 0.2 },
            skill_1: { type: "noul", noul: 0.4 },
            skill_2: { type: "noul", noul: 0.1 },
            none_relevant: { type: "noul", noul: 0.9 },
          },
        },
        candidates,
      )?.recommendations,
    ).toEqual([]);
    expect(
      parseSkillSelectionResponse(
        {
          answers: {
            skill_0: { type: "noul", noul: 0.9 },
            skill_1: { type: "noul", noul: 0.9 },
            skill_2: { type: "noul", noul: 0.8 },
            none_relevant: { type: "noul", noul: 0.1 },
          },
        },
        candidates,
        { threshold: 0.72, maxRecommendations: 2 },
      )?.recommendations,
    ).toEqual([
      { name: "security-and-hardening", score: 0.9 },
      { name: "writing-clearly", score: 0.9 },
    ]);
  });

  test("rejects malformed or incomplete responses instead of making a partial recommendation", () => {
    const candidates = [{ name: "writing-clearly", description: "writing" }];
    expect(parseSkillSelectionResponse({ answers: {} }, candidates)).toBeUndefined();
    expect(parseSkillSelectionResponseDetailed({ answers: {} }, candidates)).toEqual({
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    });
    expect(
      parseSkillSelectionResponse(
        { answers: { skill_0: { type: "noul", noul: Number.NaN } } },
        candidates,
      ),
    ).toBeUndefined();
    expect(
      parseSkillSelectionResponse(
        { answers: { skill_0: { type: "noul", noul: 0.9 } }, usage: { input_tokens: "bad" } },
        candidates,
      ),
    ).toBeUndefined();
  });

  test("keeps Gateway failures distinct from invalid evaluation responses", async () => {
    const candidates = [{ name: "writing-clearly", description: "writing" }];
    await expect(
      selectSkillsWithJevDetailed("Write a guide", candidates, DEFAULT_SKILL_SELECTION_CONFIG, {
        modelRegistry: { getProviderAuth: async () => undefined },
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "gateway-failure",
        stage: "auth",
        reason: "missing-credentials",
      },
    });

    await expect(
      selectSkillsWithJevDetailed("Write a guide", candidates, DEFAULT_SKILL_SELECTION_CONFIG, {
        modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) },
        fetch: async () => new Response(JSON.stringify({ answers: {} })),
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    });

    await expect(
      selectSkillsWithJevDetailed("Write a guide", candidates, DEFAULT_SKILL_SELECTION_CONFIG, {
        modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) },
        fetch: async () => new Response("busy", { status: 429, headers: { "Retry-After": "3" } }),
      }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "gateway-failure",
        stage: "request",
        reason: "http-status",
        httpStatus: 429,
        retryAfterMs: 3_000,
      },
    });
  });

  test("sends only bounded candidate metadata and parses an independent Jev response", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await selectSkillsWithJev(
      "Write a guide",
      [{ name: "writing-clearly", description: "Improve prose." }],
      DEFAULT_SKILL_SELECTION_CONFIG,
      {
        modelRegistry: {
          getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
        },
        fetch: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              answers: {
                skill_0: { type: "noul", noul: 0.9 },
                none_relevant: { type: "noul", noul: 0.1 },
              },
            }),
          );
        },
      },
    );

    expect(requestBody).toEqual(
      expect.objectContaining({
        model: "typesafe-ai/jev",
        state: expect.objectContaining({ request: "Write a guide" }),
      }),
    );
    expect(result?.recommendations).toEqual([{ name: "writing-clearly", score: 0.9 }]);
  });

  test("appends advisory output without changing the native catalog", async () => {
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set(["security-and-hardening"]),
      selectSkills: async (_prompt, candidates) => {
        expect(candidates.map(({ name }) => name)).toEqual(["writing-clearly"]);
        return scores({ "writing-clearly": 0.91 });
      },
    });
    const original = event();
    const result = await handler(original, context());

    expect(result).toEqual({
      systemPrompt: expect.stringContaining('<skill name="writing-clearly" relevance="0.91" />'),
    });
    expect((result as { systemPrompt: string }).systemPrompt).toContain(
      "default instructions\n\n<available_skills>catalog</available_skills>",
    );
    expect(original.systemPromptOptions.skills).toHaveLength(3);
    expect((result as { systemPrompt: string }).systemPrompt).not.toContain("hidden-workflow");
    expect((result as { systemPrompt: string }).systemPrompt).not.toContain(
      "security-and-hardening",
    );
  });

  test("falls back unchanged for unavailable Jev, explicit skills, and image prompts", async () => {
    const calls: string[] = [];
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
      selectSkills: async (prompt) => {
        calls.push(prompt);
        return undefined;
      },
    });
    const normal = event();
    expect(await handler(normal, context())).toBeUndefined();

    const explicit = event("/skill:writing-clearly");
    expect(await handler(explicit, context())).toBeUndefined();
    const expanded = event(
      '<skill name="writing-clearly" location="/skills/writing-clearly/SKILL.md">\nbody\n</skill>\n\nMake it shorter.',
    );
    expect(await handler(expanded, context())).toBeUndefined();

    const withImage = event();
    (withImage as { images: unknown[] }).images = [{ type: "image" }];
    expect(await handler(withImage, context())).toBeUndefined();
    expect(calls).toEqual(["Help me choose an approach"]);
  });

  test("honors global and project config overrides and disables malformed config", () => {
    expect(
      resolveSkillSelectionConfig(
        { jev: { skillSelection: { threshold: 0.8, timeoutMs: 500 } } },
        { jev: { skillSelection: { maxRecommendations: 2 } } },
      ),
    ).toEqual({ enabled: false, threshold: 0.8, timeoutMs: 500, maxRecommendations: 2 });
    expect(
      resolveSkillSelectionConfig({ jev: { skillSelection: { threshold: "high" } } }, {}),
    ).toEqual({
      ...DEFAULT_SKILL_SELECTION_CONFIG,
      enabled: false,
    });
    expect(resolveSkillSelectionConfig({ jev: { skillSelection: { typo: true } } }, {})).toEqual({
      ...DEFAULT_SKILL_SELECTION_CONFIG,
      enabled: false,
    });
    expect(resolveSkillSelectionConfig({ skillSelection: { enabled: true } }, {})).toEqual(
      DEFAULT_SKILL_SELECTION_CONFIG,
    );
  });

  test("formats no block for zero recommendations and escapes names", () => {
    expect(formatSkillRecommendations([])).toBe("");
    expect(formatSkillRecommendations([{ name: "a&b", score: 0.8 }])).toContain("a&amp;b");
  });
});
