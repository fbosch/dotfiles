import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import type { ClassifierRequestResult } from "../classifier";
import {
  compactDiscoveryDescription,
  type DiscoveryRankingOptions,
  DiscoverySearchError,
  MAX_DISCOVERY_CLASSIFIER_CANDIDATES,
  rankDiscovery,
  resolveClassifierToolDiscoveryConfig,
  searchCatalog,
} from "../discovery-ranking";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const registry = await createNativeClassifierRegistry();
const candidates = [
  { name: "alpha", description: "Find æøå information" },
  { name: "beta", description: "Search matching symbols" },
] as const;
const lexical = [
  { name: "beta", score: 9 },
  { name: "alpha", score: 4 },
] as const;
const usage: Usage = {
  input: 12,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};
function scores(selected = "candidate_0", count = 2): ClassifierRequestResult {
  return {
    ok: true,
    usage,
    value: {
      answers: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `candidate_${index}`,
          {
            type: "bool" as const,
            probability: `candidate_${index}` === selected ? 0.8 : 0.1,
          },
        ]),
      ),
    },
  };
}
function options(
  request: NonNullable<DiscoveryRankingOptions["request"]>,
): DiscoveryRankingOptions {
  return { modelRegistry: registry, request };
}

describe("shared discovery ranking", () => {
  test("exploration ranks multiple independently relevant capabilities", async () => {
    const result = await rankDiscovery(
      candidates,
      lexical,
      "alpha",
      3,
      options(async () => ({
        ok: true,
        usage,
        value: {
          answers: {
            candidate_0: { type: "bool", probability: 0.8 },
            candidate_1: { type: "bool", probability: 0.9 },
          },
        },
      })),
    );
    expect(result).toEqual({
      matches: [
        { name: "alpha", score: 0.9 },
        { name: "beta", score: 0.8 },
      ],
      rankingSource: "classifier",
      usage,
    });
  });
  test("explicit lookup returns only an exact visible name without classification", async () => {
    let requests = 0;
    const opts = {
      ...options(async () => {
        requests++;
        return scores();
      }),
      mode: "lookup" as const,
    };
    expect(await rankDiscovery(candidates, lexical, "alpha", 3, opts)).toEqual({
      matches: [{ name: "alpha", score: 1 }],
      rankingSource: "lookup",
    });
    expect(await rankDiscovery(candidates, lexical, "alph", 3, opts)).toEqual({
      matches: [],
      rankingSource: "lookup",
    });
    expect(requests).toBe(0);
  });
  test("disabled classification preserves lexical order and limit without a request", async () => {
    let requests = 0;
    const result = await rankDiscovery(candidates, lexical, "find", 1, {
      ...options(async () => {
        requests += 1;
        return scores();
      }),
      enabled: false,
    });
    expect(result).toEqual({
      matches: [lexical[0]],
      rankingSource: "lexical",
      fallbackReason: "disabled",
    });
    expect(requests).toBe(0);
  });

  test("classifier selection uses lexical-first IDs and retains usage", async () => {
    const result = await rankDiscovery(
      candidates,
      lexical,
      "meaning",
      3,
      options(async (_registry, input) => {
        expect(input.state).toEqual({
          query: "meaning",
          candidates: [
            { id: "candidate_0", name: "beta", description: "Search matching symbols" },
            { id: "candidate_1", name: "alpha", description: "Find æøå information" },
          ],
        });
        return scores("candidate_1");
      }),
    );
    expect(result).toEqual({
      matches: [{ name: "alpha", score: 0.8 }],
      rankingSource: "classifier",
      usage,
    });
  });
  test.each([
    "model-unavailable",
    "auth-failure",
    "timeout",
    "http-status",
    "invalid-response",
  ] as const)("fallback exposes only safe reason %s and retains usage", async (reason) => {
    const result = await rankDiscovery(
      candidates,
      lexical,
      "find",
      1,
      options(async () => ({
        ok: false,
        stage: "request",
        reason,
        usage,
        provider: "openrouter",
        httpStatus: 503,
        retryAfterMs: 10,
      })),
    );
    expect(result).toEqual({
      matches: [lexical[0]],
      rankingSource: "lexical",
      fallbackReason: reason,
      usage,
    });
  });

  test("semantic search can select a candidate without a lexical match", async () => {
    expect(
      (
        await rankDiscovery(
          candidates,
          [],
          "semantic capability",
          1,
          options(async () => scores()),
        )
      ).matches,
    ).toEqual([{ name: "alpha", score: 0.8 }]);
  });

  test("abstention stays empty rather than loading a lexical fallback", async () => {
    expect(
      await rankDiscovery(
        candidates,
        lexical,
        "unrelated",
        3,
        options(async () => scores("no_match")),
      ),
    ).toEqual({ matches: [], rankingSource: "classifier", usage });
  });

  test("request failure retains attempted usage and returns lexical matches", async () => {
    const result = await rankDiscovery(
      candidates,
      lexical,
      "find",
      1,
      options(async () => ({
        ok: false,
        stage: "request",
        reason: "request-failure",
        usage,
      })),
    );
    expect(result).toEqual({
      matches: [lexical[0]],
      rankingSource: "lexical",
      fallbackReason: "request-failure",
      usage,
    });
  });

  test("incomplete relevance answers fall back to known lexical matches", async () => {
    expect(
      await rankDiscovery(
        candidates,
        lexical,
        "find",
        2,
        options(async () => scores("candidate_0", 1)),
      ),
    ).toEqual({
      matches: [...lexical],
      rankingSource: "lexical",
      fallbackReason: "invalid-response",
      usage,
    });
  });

  test("wrong answer kind falls back without dropping usage", async () => {
    const response: ClassifierRequestResult = {
      ok: true,
      usage,
      value: {
        answers: {
          candidate_0: {
            type: "choice",
            choice: "yes",
            probabilities: { yes: 0.8 },
            confidence: 0.8,
          },
        },
      },
    };
    expect(
      (
        await rankDiscovery(
          candidates,
          lexical,
          "find",
          2,
          options(async () => response),
        )
      ).rankingSource,
    ).toBe("lexical");
  });

  test("empty candidates and blank queries never invoke the classifier", async () => {
    let requests = 0;
    const opts = options(async () => {
      requests += 1;
      return scores();
    });
    expect(await rankDiscovery([], [], "find", 1, opts)).toEqual({
      matches: [],
      rankingSource: "lexical",
    });
    expect(await rankDiscovery(candidates, [], "  ", 1, opts)).toEqual({
      matches: [],
      rankingSource: "lexical",
    });
    expect(await rankDiscovery(candidates, [], "  ", 1, { ...opts, enabled: false })).toEqual({
      matches: [],
      rankingSource: "lexical",
    });
    expect(requests).toBe(0);
  });

  test("candidate pool is bounded and deterministic with lexical hits first", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `tool_${String(i).padStart(3, "0")}`,
      description: "Capability",
    }));
    let submitted: ClassifierContext | undefined;
    await rankDiscovery(
      many,
      [{ name: "tool_039", score: 10 }],
      "find",
      1,
      options(async (_registry, input) => {
        submitted = input;
        return scores();
      }),
    );
    expect(submitted?.state.candidates).toEqual([
      { id: "candidate_0", name: "tool_039", description: "Capability" },
      ...many
        .slice(0, MAX_DISCOVERY_CLASSIFIER_CANDIDATES - 1)
        .map((candidate, i) => ({ id: `candidate_${i + 1}`, ...candidate })),
    ]);
  });

  test("tags reach model state and choice criteria with bounded public context", async () => {
    const tags = [
      "  æøå\nPRIVATE_TAG_DETAILS",
      "",
      "æøå",
      "x".repeat(100),
      ...Array.from({ length: 12 }, (_, index) => `tag-${index}`),
    ];
    const expectedTags = [
      "æøå",
      "x".repeat(64),
      ...Array.from({ length: 6 }, (_, index) => `tag-${index}`),
    ];
    const candidate = {
      name: "opaque",
      description: "Run a helper",
      tags,
      command: "PRIVATE_COMMAND",
    };
    const result = await rankDiscovery(
      [candidate],
      [],
      "æøå",
      1,
      options(async (_registry, input) => {
        expect(input.state.candidates).toEqual([
          { id: "candidate_0", name: "opaque", description: "Run a helper", tags: expectedTags },
        ]);
        const question = input.questions.candidate_0;
        if (question?.type !== "bool") throw new Error("relevance criteria missing");
        expect(question.instructions).toContain("opaque");
        expect(question.instructions).toContain("tags");
        expect(JSON.stringify(input)).not.toContain("PRIVATE_TAG_DETAILS");
        expect(JSON.stringify(input)).not.toContain("PRIVATE_COMMAND");
        return scores();
      }),
    );
    expect(result.matches).toEqual([{ name: "opaque", score: 0.8 }]);
  });

  test("only bounded public names and first-line descriptions enter model state", async () => {
    const candidate = {
      name: "alpha",
      description: `${"æ".repeat(300)}\nPRIVATE_COMMAND_BODY`,
      parameters: { secret: "PRIVATE_SCHEMA" },
    };
    await rankDiscovery(
      [candidate],
      [],
      "find",
      1,
      options(async (_registry, input) => {
        const serialized = JSON.stringify(input);
        expect(serialized).not.toContain("PRIVATE_COMMAND_BODY");
        expect(serialized).not.toContain("PRIVATE_SCHEMA");
        expect(serialized).toContain(compactDiscoveryDescription(candidate.description));
        expect(compactDiscoveryDescription(candidate.description).length).toBeLessThanOrEqual(180);
        return scores();
      }),
    );
  });

  test("caller cancellation before dispatch prevents a request", async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    await expect(
      rankDiscovery(candidates, lexical, "find", 1, {
        ...options(async () => {
          requests += 1;
          return scores();
        }),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(DOMException);
    expect(requests).toBe(0);
  });

  test("late cancellation rejects a completed classification", async () => {
    const controller = new AbortController();
    const reportedUsage: Usage[] = [];
    await expect(
      rankDiscovery(candidates, lexical, "find", 1, {
        ...options(async (_registry, _input, requestOptions) => {
          expect(requestOptions.signal).toBe(controller.signal);
          controller.abort();
          return scores();
        }),
        signal: controller.signal,
        onUsage: (value: Usage) => {
          reportedUsage.push(value);
        },
      }),
    ).rejects.toBeInstanceOf(DOMException);
    expect(reportedUsage).toEqual([usage]);
  });

  test("invalid lexical matches and duplicate candidates fail before submission", async () => {
    let requests = 0;
    const opts = options(async () => {
      requests += 1;
      return scores();
    });
    await expect(
      rankDiscovery(candidates, [{ name: "forbidden", score: 1 }], "find", 1, opts),
    ).rejects.toThrow("Invalid lexical");
    await expect(
      rankDiscovery(candidates, [lexical[0], lexical[0]], "find", 1, opts),
    ).rejects.toThrow("Invalid lexical");
    await expect(
      rankDiscovery([candidates[0], candidates[0]], [], "find", 1, opts),
    ).rejects.toThrow("Duplicate");
    expect(requests).toBe(0);
  });

  test("invalid limits fail before classification", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await expect(
        rankDiscovery(
          candidates,
          lexical,
          "find",
          limit,
          options(async () => scores()),
        ),
      ).rejects.toThrow("positive integer");
    }
  });
});

test("resolves Classifier settings with safe defaults, bounds, and trusted project overrides", () => {
  expect(resolveClassifierToolDiscoveryConfig({}, undefined)).toEqual({
    enabled: true,
    timeoutMs: 2400,
  });
  expect(
    resolveClassifierToolDiscoveryConfig({
      classifier: { toolDiscovery: { enabled: false, timeoutMs: 1500 } },
    }),
  ).toEqual({ enabled: false, timeoutMs: 1500 });
  expect(
    resolveClassifierToolDiscoveryConfig({ classifier: { toolDiscovery: { timeoutMs: 0 } } }),
  ).toEqual({ enabled: false, timeoutMs: 2400 });
  expect(resolveClassifierToolDiscoveryConfig({ classifier: null })).toEqual({
    enabled: false,
    timeoutMs: 2400,
  });
  expect(
    resolveClassifierToolDiscoveryConfig({ classifier: { toolDiscovery: { enabled: null } } }),
  ).toEqual({ enabled: false, timeoutMs: 2400 });
  expect(
    resolveClassifierToolDiscoveryConfig(
      { classifier: { toolDiscovery: { enabled: true } } },
      { classifier: { toolDiscovery: { enabled: false } } },
    ),
  ).toEqual({ enabled: false, timeoutMs: 2400 });
  expect(
    resolveClassifierToolDiscoveryConfig(
      {
        classifier: { toolDiscovery: { enabled: false } },
        toolDiscovery: { deferredToolPrefixes: ["global_"] },
      },
      { toolDiscovery: { deferredToolPrefixes: ["project_"] } },
    ),
  ).toEqual({ enabled: false, timeoutMs: 2400 });
});

describe("catalog search", () => {
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const agentDirectory = mkdtempSync(join(tmpdir(), "discovery-catalog-search-"));
  const projectDirectory = mkdtempSync(join(tmpdir(), "discovery-catalog-project-"));
  const context = { cwd: projectDirectory, isProjectTrusted: () => false, modelRegistry: registry };
  type Item = { id: string; summary: string; groups: string[] };
  const alpha: Item = { id: "alpha", summary: "Find æøå information", groups: ["lookup"] };
  const beta: Item = { id: "beta", summary: "Search matching symbols", groups: [] };
  const catalog = [alpha, beta];
  const describeCatalog = {
    key: (item: Item) => item.id,
    describe: (item: Item) => item.summary,
    tags: (item: Item) => item.groups,
  };
  function settings(value: unknown): void {
    writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify(value));
  }

  beforeAll(() => {
    process.env.PI_CODING_AGENT_DIR = agentDirectory;
  });
  afterAll(() => {
    if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(agentDirectory, { recursive: true, force: true });
    rmSync(projectDirectory, { recursive: true, force: true });
  });

  test("returns the selected catalog items with ranking source and usage", async () => {
    settings({});
    let input: ClassifierContext | undefined;
    const result = await searchCatalog(catalog, {
      ...describeCatalog,
      lexical,
      query: "find",
      limit: 1,
      context,
      request: async (_registry, request) => {
        input = request;
        return scores("candidate_1");
      },
    });
    expect(result).toEqual({ items: [alpha], rankingSource: "classifier", usage });
    expect(JSON.stringify(input?.state)).toContain("lookup");
  });

  test("reads the classifier switch from settings and skips inference when disabled", async () => {
    settings({ classifier: { toolDiscovery: { enabled: false } } });
    let requests = 0;
    const result = await searchCatalog(catalog, {
      ...describeCatalog,
      lexical,
      query: "find",
      limit: 1,
      context,
      request: async () => {
        requests += 1;
        return scores();
      },
    });
    expect(result).toEqual({
      items: [beta],
      rankingSource: "lexical",
      fallbackReason: "disabled",
    });
    expect(requests).toBe(0);
  });

  test("a supplied config replaces the settings read", async () => {
    settings({ classifier: { toolDiscovery: { enabled: true } } });
    const result = await searchCatalog(catalog, {
      ...describeCatalog,
      lexical,
      query: "find",
      limit: 2,
      context,
      config: { enabled: false, timeoutMs: 2400 },
      request: async () => {
        throw new Error("classifier must not run");
      },
    });
    expect(result.items).toEqual([beta, alpha]);
    expect(result.fallbackReason).toBe("disabled");
  });

  test("duplicate catalog keys fail before inference", async () => {
    settings({});
    await expect(
      searchCatalog([alpha, alpha], {
        ...describeCatalog,
        lexical: [],
        query: "find",
        limit: 1,
        context,
        request: async () => scores(),
      }),
    ).rejects.toThrow("Duplicate discovery candidate names");
  });

  test("a failure after billed inference carries its usage", async () => {
    settings({});
    const controller = new AbortController();
    const error = await searchCatalog(catalog, {
      ...describeCatalog,
      lexical,
      query: "find",
      limit: 1,
      context,
      signal: controller.signal,
      request: async () => {
        controller.abort(new Error("caller stopped"));
        return scores();
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscoverySearchError);
    expect(error).toMatchObject({ message: "caller stopped", usage });
  });

  test("a failure before inference is rethrown unchanged", async () => {
    settings({});
    const controller = new AbortController();
    const reason = new Error("already stopped");
    controller.abort(reason);
    await expect(
      searchCatalog(catalog, {
        ...describeCatalog,
        lexical,
        query: "find",
        limit: 1,
        context,
        signal: controller.signal,
        request: async () => scores(),
      }),
    ).rejects.toBe(reason);
  });
});
