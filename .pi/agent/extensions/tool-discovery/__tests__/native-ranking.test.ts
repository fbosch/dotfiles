import { describe, expect, test } from "bun:test";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import type { ClassifierRequestResult } from "../../../lib/classifier";
import type { DiscoveryRankingOptions } from "../../../lib/discovery-ranking";
import {
  createNativeDiscoveryRanker,
  hasNativeToolSearchHooks,
  type NativeToolSearchRequest,
} from "../native-ranking";

const modelRegistry = await createNativeClassifierRegistry();
const context = { modelRegistry } as ExtensionContext;
const candidates = [
  { name: "alpha", description: "Alpha" },
  { name: "beta", description: "Beta" },
];
const documents = [
  { name: "forbidden", text: "Private schema", description: "Private capability" },
  { name: "alpha", text: "Alpha schema", description: "Alpha" },
  { name: "beta", text: "Beta schema", description: "Beta" },
];
const lexical = [
  { name: "forbidden", score: 20 },
  { name: "beta", score: 9 },
  { name: "alpha", score: 4 },
];
const usage: Usage = {
  input: 2,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};
function request(overrides: Partial<NativeToolSearchRequest> = {}): NativeToolSearchRequest {
  return {
    context,
    query: "find capability",
    documents,
    limit: 1,
    rankLexical: () => lexical,
    ...overrides,
  };
}
function options(reply: ClassifierRequestResult, enabled = true): DiscoveryRankingOptions {
  return { modelRegistry, enabled, request: async () => reply };
}
const unavailable: ClassifierRequestResult = {
  ok: false,
  stage: "config",
  reason: "model-unavailable",
  usage,
};

describe("native discovery adapter", () => {
  test("detects only the patched SDK registration capability", () => {
    expect(hasNativeToolSearchHooks(null)).toBe(false);
    expect(hasNativeToolSearchHooks(undefined)).toBe(false);
    expect(hasNativeToolSearchHooks({})).toBe(false);
    expect(hasNativeToolSearchHooks({ installToolSearchRanker: "unsupported" })).toBe(false);
    expect(hasNativeToolSearchHooks({ installToolSearchRanker: () => () => {} })).toBe(true);
  });

  test("disabled classification preserves native lexical scores after admission filtering", async () => {
    let classificationRequests = 0;
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => ({
        modelRegistry,
        enabled: false,
        request: async () => {
          classificationRequests += 1;
          return unavailable;
        },
      }),
    );
    const limits: number[] = [];
    const result = await ranker(
      request({
        rankLexical: (limit) => {
          limits.push(limit);
          return lexical;
        },
      }),
    );
    expect(result).toEqual({ matches: [{ name: "beta", score: 9 }], rankingSource: "lexical" });
    expect(limits).toEqual([3]);
    expect(classificationRequests).toBe(0);
  });

  test("unavailable classification keeps lexical ordering, the requested limit, and attempted usage", async () => {
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => options(unavailable),
    );
    expect(await ranker(request({ limit: 2 }))).toEqual({
      matches: [
        { name: "beta", score: 9 },
        { name: "alpha", score: 4 },
      ],
      rankingSource: "lexical",
      usage,
    });
  });

  test("a valid no_match does not load a lexical fallback and retains usage", async () => {
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () =>
        options({
          ok: true,
          usage,
          value: {
            answers: {
              best_tool: {
                type: "choice",
                choice: "no_match",
                probabilities: { no_match: 1 },
                confidence: 1,
              },
            },
          },
        }),
    );
    expect(await ranker(request())).toEqual({ matches: [], rankingSource: "classifier", usage });
  });

  test("native namespace-scoped documents cannot be expanded by the global candidate registry", async () => {
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => ({
        modelRegistry,
        request: async (_registry, input) => {
          expect(input.state.candidates).toEqual([
            { id: "candidate_0", name: "beta", description: "Beta" },
          ]);
          return {
            ok: true,
            value: {
              answers: {
                best_tool: {
                  type: "choice",
                  choice: "candidate_0",
                  probabilities: { candidate_0: 1 },
                  confidence: 1,
                },
              },
            },
          };
        },
      }),
    );
    const result = await ranker(
      request({
        documents: [{ name: "beta", text: "Beta", description: "Beta" }],
        rankLexical: () => [{ name: "beta", score: 9 }],
      }),
    );
    expect(result.matches).toEqual([{ name: "beta", score: 1 }]);
  });

  test("empty native documents never call lexical ranking or classification", async () => {
    let lexicalCalls = 0;
    let classificationCalls = 0;
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => ({
        modelRegistry,
        request: async () => {
          classificationCalls += 1;
          return unavailable;
        },
      }),
    );
    expect(
      await ranker(
        request({
          documents: [],
          rankLexical: () => {
            lexicalCalls += 1;
            return [];
          },
        }),
      ),
    ).toEqual({ matches: [], rankingSource: "lexical" });
    expect(lexicalCalls).toBe(0);
    expect(classificationCalls).toBe(0);
  });

  test("missing session context fails before lexical ranking or classification", async () => {
    let lexicalCalls = 0;
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => options(unavailable),
    );
    await expect(
      ranker({
        query: "find",
        documents,
        limit: 1,
        rankLexical: () => {
          lexicalCalls += 1;
          return lexical;
        },
      }),
    ).rejects.toThrow("session context");
    expect(lexicalCalls).toBe(0);
  });

  test("caller cancellation rejects a late classifier reply", async () => {
    const controller = new AbortController();
    const reported: Usage[] = [];
    const ranker = createNativeDiscoveryRanker(
      () => candidates,
      () => ({
        modelRegistry,
        request: async (_registry, _input, requestOptions) => {
          expect(requestOptions.signal).toBe(controller.signal);
          controller.abort();
          return unavailable;
        },
      }),
    );
    await expect(
      ranker(
        request({
          signal: controller.signal,
          reportUsage: (value: Usage) => {
            reported.push(value);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DOMException);
    expect(reported).toEqual([usage]);
  });
});
