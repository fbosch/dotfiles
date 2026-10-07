import { describe, expect, test } from "bun:test";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  Skill,
} from "@earendil-works/pi-coding-agent";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { SKILL_ADVISORY_MESSAGE } from "../advisory-state";
import { buildMidTaskPrompt } from "../mid-task";
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
  selectSkillsWithClassifier,
  selectSkillsWithClassifierDetailed,
} from "../selection";

const classifierRegistry = await createNativeClassifierRegistry();

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
    | ((
        event: BeforeAgentStartEvent,
        context: ExtensionContext,
      ) =>
        | Promise<BeforeAgentStartEventResult | undefined>
        | BeforeAgentStartEventResult
        | undefined)
    | undefined;
  const extension = createSkillSelectionExtension(dependencies);
  const api = {
    events: createEventBus(),
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    registerCommand: () => {},
    on: (_event: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as ExtensionAPI;
  extension(api);
  if (handler === undefined) throw new Error("extension did not register a handler");
  return handler;
}

function lifecycleHarness(dependencies: Parameters<typeof createSkillSelectionExtension>[0] = {}) {
  let handler:
    | ((event: BeforeAgentStartEvent, context: ExtensionContext) => Promise<unknown> | unknown)
    | undefined;
  let statusCommand: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
  const extension = createSkillSelectionExtension(dependencies);
  extension({
    events: createEventBus(),
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    registerCommand: (name: string, definition: { handler: typeof statusCommand }) => {
      if (name === "classifier-status") statusCommand = definition.handler;
    },
    on: (_event: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as ExtensionAPI);
  if (handler === undefined || statusCommand === undefined) throw new Error("extension incomplete");
  return { handler, statusCommand };
}

function context(sessionManager?: ExtensionContext["sessionManager"]): ExtensionContext {
  return {
    cwd: "/tmp/skill-selection-test",
    hasUI: false,
    isProjectTrusted: () => true,
    modelRegistry: classifierRegistry,
    sessionManager: sessionManager ?? {
      getBranch: () => [],
      buildSessionProjection: () => ({ entries: [], messages: [], thinkingLevel: "", model: null }),
    },
  } as unknown as ExtensionContext;
}

function event(prompt = "Help me choose an approach") {
  return {
    prompt,
    systemPrompt: "default instructions\n\n<available_skills>catalog</available_skills>",
    systemPromptOptions: {
      sections: {},
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
    noMatchScore: recommendations.length === 0 ? 1 : 0,
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
    expect(questions.skill_0?.type).toBe("bool");
    expect(questions.skill_1?.type).toBe("bool");
    expect(questions.none_relevant?.type).toBe("bool");
    expect(JSON.stringify(request)).not.toContain("SKILL.md");
  });

  test.each([
    ["input", "What's the status?"],
    [
      "mid-task",
      buildMidTaskPrompt({
        goal: "What's the status?",
        latestVisibleActivity: "Checking which tasks are complete.",
        visibleActivity: ["Checking which tasks are complete."],
        toolObservations: ["Completed TaskList: ok"],
        deltaVisibleActivity: ["Checking which tasks are complete."],
        deltaToolObservations: ["Completed TaskList: ok"],
        alreadyRead: [],
        alreadyRecommended: [],
      }) ?? "",
    ],
  ])("requires current workflow evidence in %s selection questions", (_stage, prompt) => {
    const request = createSkillSelectionRequest(prompt, [
      {
        name: "openspec-apply-change",
        description: "Implement tasks from an OpenSpec change.",
      },
    ]);
    expect(request?.questions.skill_0).toEqual({
      type: "bool",
      instructions:
        "Does the supplied request or current-activity snapshot contain concrete evidence that the specific workflow described by openspec-apply-change applies now? Implement tasks from an OpenSpec change.",
      criteria: {
        true: "The described trigger or workflow applies to the requested action or evidenced remaining work, with its required context established.",
        false:
          "Only broad topic overlap, hypothetical future usefulness, or missing workflow prerequisites. A generic status check or continuation request is not evidence of a specialized workflow unless the supplied state identifies it. Completed tools alone do not establish intent to perform that workflow next.",
      },
    });
    expect(request?.questions.none_relevant).toEqual({
      type: "bool",
      instructions:
        "Does the supplied request or current-activity snapshot lack concrete evidence for every listed skill's specific workflow?",
      criteria: {
        true: "No listed skill's described trigger or workflow applies now with its required context established; broad topic overlap or hypothetical usefulness is insufficient.",
        false:
          "At least one listed skill's described trigger or workflow applies to the requested action or evidenced remaining work, with its required context established.",
      },
    });
    expect(DEFAULT_SKILL_SELECTION_CONFIG.threshold).toBe(0.72);
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
          skill_0: { type: "bool", probability: 0.2 },
          skill_1: { type: "bool", probability: 0.4 },
          skill_2: { type: "bool", probability: 0.1 },
          none_relevant: { type: "bool", probability: 0.9 },
        },
        candidates,
      )?.recommendations,
    ).toEqual([]);
    expect(
      parseSkillSelectionResponse(
        {
          skill_0: { type: "bool", probability: 0.9 },
          skill_1: { type: "bool", probability: 0.9 },
          skill_2: { type: "bool", probability: 0.8 },
          none_relevant: { type: "bool", probability: 0.1 },
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
    expect(parseSkillSelectionResponse({}, candidates)).toBeUndefined();
    expect(parseSkillSelectionResponseDetailed({}, candidates)).toEqual({
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    });
    expect(
      parseSkillSelectionResponse(
        { skill_0: { type: "bool", probability: Number.NaN } },
        candidates,
      ),
    ).toBeUndefined();
    expect(
      parseSkillSelectionResponse({ skill_0: { type: "bool", probability: 0.9 } }, candidates),
    ).toBeUndefined();
  });

  test("keeps classifier failures distinct from invalid evaluation responses", async () => {
    const candidates = [{ name: "writing-clearly", description: "writing" }];
    await expect(
      selectSkillsWithClassifierDetailed(
        "Write a guide",
        candidates,
        DEFAULT_SKILL_SELECTION_CONFIG,
        {
          modelRegistry: {
            findOfType: () => undefined,
            classify: classifierRegistry.classify.bind(classifierRegistry),
          },
        },
      ),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "classifier-failure",
        provider: "vercel-ai-gateway",
        stage: "config",
        reason: "model-unavailable",
      },
    });

    await expect(
      selectSkillsWithClassifierDetailed(
        "Write a guide",
        candidates,
        DEFAULT_SKILL_SELECTION_CONFIG,
        {
          modelRegistry: classifierRegistry,
          fetch: async () => new Response(JSON.stringify({ answers: {} })),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "classifier-failure",
        provider: "vercel-ai-gateway",
        stage: "request",
        reason: "request-failure",
      },
    });

    await expect(
      selectSkillsWithClassifierDetailed(
        "Write a guide",
        candidates,
        DEFAULT_SKILL_SELECTION_CONFIG,
        {
          modelRegistry: classifierRegistry,
          // Zero delay preserves metadata coverage without holding the provider in cooldown.
          fetch: async () => new Response("busy", { status: 429, headers: { "Retry-After": "0" } }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: "classifier-failure",
        provider: "vercel-ai-gateway",
        stage: "request",
        reason: "http-status",
        httpStatus: 429,
        retryAfterMs: 0,
      },
    });
  });

  test("sends only bounded candidate metadata and parses an independent Classifier response", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await selectSkillsWithClassifier(
      "Write a guide",
      [{ name: "writing-clearly", description: "Improve prose." }],
      DEFAULT_SKILL_SELECTION_CONFIG,
      {
        modelRegistry: classifierRegistry,
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
        state: expect.objectContaining({ request: "Write a guide" }),
      }),
    );
    expect(result?.recommendations).toEqual([{ name: "writing-clearly", score: 0.9 }]);
  });

  test("returns append-only advice without changing the cache-stable prompt sections", async () => {
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set(["security-and-hardening"]),
      selectSkillsDetailed: async (_prompt, candidates) => {
        expect(candidates.map(({ name }) => name)).toEqual(["writing-clearly"]);
        return { ok: true, value: scores({ "writing-clearly": 0.91 }) };
      },
    });
    const original = event();
    const result = await handler(original, context());

    const message = result && "message" in result ? result.message : undefined;
    const recommendation = message?.content;
    expect(typeof recommendation).toBe("string");
    expect(result).toMatchObject({
      message: {
        customType: "skill-recommendation-advice",
        display: false,
        content: expect.stringContaining(
          'name="writing-clearly" location="/skills/writing-clearly/SKILL.md" description="Improve documentation prose."',
        ),
      },
    });
    expect(original.systemPromptOptions.sections).toEqual({});
    expect(original.systemPrompt).toBe(
      "default instructions\n\n<available_skills>catalog</available_skills>",
    );
    expect(original.systemPromptOptions.skills).toHaveLength(3);
    expect(recommendation).not.toContain("hidden-workflow");
    expect(recommendation).not.toContain("security-and-hardening");
  });

  test("announces exactly the bounded description evaluated by the classifier", async () => {
    let evaluated = "";
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set(),
      selectSkillsDetailed: async (_prompt, candidates) => {
        evaluated = candidates[0]?.description ?? "";
        return { ok: true, value: scores({ "writing-clearly": 0.9 }) };
      },
    });
    const request = event();
    request.systemPromptOptions.skills = [
      skill("writing-clearly", {
        description: `  Read   lifecycle   ${"detail ".repeat(100)}UNBOUNDED_TAIL`,
      }),
    ];
    const result = await handler(request, context());
    expect(evaluated).toHaveLength(400);
    expect(evaluated).toStartWith("Read lifecycle ");
    expect(evaluated).toEndWith("…");
    const message = result && "message" in result ? result.message : undefined;
    expect(message?.content).toContain(`description="${evaluated}"`);
    expect(message?.content).not.toContain("UNBOUNDED_TAIL");
  });

  test("deduplicates successive input advice on the active branch", async () => {
    let calls = 0;
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set(["security-and-hardening"]),
      selectSkillsDetailed: async () => {
        calls += 1;
        return { ok: true, value: scores({ "writing-clearly": 0.9 }) };
      },
    });
    const manager = SessionManager.inMemory("/tmp/skill-selection-test");
    manager.appendMessage({ role: "user", content: "first", timestamp: 1 });
    const ctx = context(manager);
    const first = await handler(event(), ctx);
    if (!first || !("message" in first)) throw new Error("Expected initial advice message");
    manager.appendMessage({
      role: "custom",
      ...first.message,
      timestamp: 2,
    });

    const second = await handler(event("Continue"), ctx);
    expect(second).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("skips classifier when positive headroom cannot fit one whole record", async () => {
    let calls = 0;
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
      selectSkillsDetailed: async () => {
        calls += 1;
        return { ok: true, value: scores({ "writing-clearly": 0.9 }) };
      },
    });
    const manager = SessionManager.inMemory("/tmp/skill-selection-test");
    manager.appendMessage({ role: "user", content: "prior", timestamp: 1 });
    manager.appendCustomMessageEntry(SKILL_ADVISORY_MESSAGE, "x".repeat(5_950), false, {
      skills: [],
    });
    const result = await handler(event(), context(manager));
    expect(result).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("falls back unchanged for unavailable Classifier, explicit skills, and image prompts", async () => {
    const calls: string[] = [];
    const handler = extensionHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
      selectSkillsDetailed: async (prompt) => {
        calls.push(prompt);
        return {
          ok: false,
          failure: {
            kind: "classifier-failure",
            stage: "auth",
            reason: "auth-failure",
          },
        };
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

  test("records actual callback skip reasons without consulting auth", async () => {
    let authCalls = 0;
    const { handler, statusCommand } = lifecycleHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
    });
    const ctx = {
      ...context(),
      modelRegistry: {
        findOfType: (...args: Parameters<typeof classifierRegistry.findOfType>) =>
          classifierRegistry.findOfType(...args),
        classify: (...args: Parameters<typeof classifierRegistry.classify>) => {
          authCalls += 1;
          return classifierRegistry.classify(...args);
        },
      },
    } as unknown as ExtensionContext;
    const notifications: string[] = [];
    const commandContext = {
      ...ctx,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionContext;

    await handler(event("/skill:writing-clearly"), ctx);
    await statusCommand("", commandContext);
    expect(JSON.parse(notifications.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        enabled: false,
        eventCount: 1,
        state: "skipped",
        reason: "explicit-skill",
        fetchAttempted: false,
      }),
    );
    expect(authCalls).toBe(0);

    const noCandidates = event();
    noCandidates.systemPromptOptions.skills = [
      skill("hidden", { disableModelInvocation: true }),
      { ...skill("missing-flag"), disableModelInvocation: undefined },
    ] as unknown as Skill[];
    await handler(noCandidates, ctx);
    await statusCommand("", commandContext);
    expect(JSON.parse(notifications.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        enabled: true,
        eventCount: 2,
        state: "skipped",
        reason: "no-candidates",
        fetchAttempted: false,
      }),
    );
    expect(authCalls).toBe(0);
  });

  test("distinguishes transport failure from semantic no-match in actual callback status", async () => {
    let clock = 10;
    const unavailable = lifecycleHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
      fetch: async () => {
        throw new Error("offline");
      },
      now: () => clock++,
    });
    const ctx = {
      ...context(),
      modelRegistry: classifierRegistry,
    } as unknown as ExtensionContext;
    const notifications: string[] = [];
    const commandContext = {
      ...ctx,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionContext;

    await unavailable.handler(event(), ctx);
    await unavailable.statusCommand("", commandContext);
    expect(JSON.parse(notifications.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        state: "failed",
        reason: "request-failure",
        failureStage: "request",
        fetchAttempted: true,
      }),
    );

    const noMatch = lifecycleHarness({
      getConfig: () => ENABLED_CONFIG,
      getDisabledNames: () => new Set<string>(),
      fetch: async () =>
        new Response(
          JSON.stringify({
            answers: {
              skill_0: { type: "noul", noul: 0.1 },
              skill_1: { type: "noul", noul: 0.2 },
              none_relevant: { type: "noul", noul: 0.9 },
            },
          }),
        ),
    });
    await noMatch.handler(event(), ctx);
    await noMatch.statusCommand("", commandContext);
    expect(JSON.parse(notifications.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        state: "completed",
        reason: "no-match",
        candidateCount: 2,
        fetchAttempted: true,
      }),
    );
  });

  test("honors global and project config overrides and disables malformed config", () => {
    expect(
      resolveSkillSelectionConfig(
        { classifier: { skillSelection: { threshold: 0.8, timeoutMs: 500 } } },
        { classifier: { skillSelection: { maxRecommendations: 2 } } },
      ),
    ).toEqual({ enabled: false, threshold: 0.8, timeoutMs: 500, maxRecommendations: 2 });
    expect(
      resolveSkillSelectionConfig({ classifier: { skillSelection: { threshold: "high" } } }, {}),
    ).toEqual({
      ...DEFAULT_SKILL_SELECTION_CONFIG,
      enabled: false,
    });
    expect(
      resolveSkillSelectionConfig({ classifier: { skillSelection: { typo: true } } }, {}),
    ).toEqual({
      ...DEFAULT_SKILL_SELECTION_CONFIG,
      enabled: false,
    });
    expect(resolveSkillSelectionConfig({ skillSelection: { enabled: true } }, {})).toEqual(
      DEFAULT_SKILL_SELECTION_CONFIG,
    );
  });

  test("formats no block for zero recommendations and escapes names", () => {
    expect(formatSkillRecommendations([])).toBe("");
    expect(
      formatSkillRecommendations([
        { name: "a&b", path: "/skills/a&b/SKILL.md", description: "A & B" },
      ]),
    ).toContain("a&amp;b");
  });
});
