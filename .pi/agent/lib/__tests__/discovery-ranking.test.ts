import { describe, expect, test } from "bun:test";
import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import type { ClassifierRequestResult } from "../classifier";
import {
  compactDiscoveryDescription,
  type DiscoveryRankingOptions,
  MAX_DISCOVERY_CLASSIFIER_CANDIDATES,
  rankDiscovery,
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
function choice(selected = "candidate_0"): ClassifierRequestResult {
  return {
    ok: true,
    usage,
    value: {
      answers: {
        best_tool: {
          type: "choice",
          choice: selected,
          probabilities: { [selected]: 0.8 },
          confidence: 0.8,
        },
      },
    },
  };
}
function options(
  request: NonNullable<DiscoveryRankingOptions["request"]>,
): DiscoveryRankingOptions {
  return { modelRegistry: registry, request };
}

describe("shared discovery ranking", () => {
  test("disabled classification preserves lexical order and limit without a request", async () => {
    let requests = 0;
    const result = await rankDiscovery(candidates, lexical, "find", 1, {
      ...options(async () => {
        requests += 1;
        return choice();
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
        return choice("candidate_1");
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
          options(async () => choice()),
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
        options(async () => choice("no_match")),
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

  test("unknown choices fail back to known lexical matches", async () => {
    expect(
      await rankDiscovery(
        candidates,
        lexical,
        "find",
        2,
        options(async () => choice("forbidden")),
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
          best_tool: { type: "bool", probability: 0.8 },
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
      return choice();
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
        return choice();
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
        const question = input.questions.best_tool;
        if (question?.type !== "choice") throw new Error("choice criteria missing");
        expect(question.criteria.candidate_0).toBe(
          `opaque: Run a helper [tags: ${expectedTags.join(", ")}]`,
        );
        expect(question.instructions).toContain("tags");
        expect(JSON.stringify(input)).not.toContain("PRIVATE_TAG_DETAILS");
        expect(JSON.stringify(input)).not.toContain("PRIVATE_COMMAND");
        return choice();
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
        return choice();
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
          return choice();
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
          return choice();
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
      return choice();
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
          options(async () => choice()),
        ),
      ).rejects.toThrow("positive integer");
    }
  });
});
