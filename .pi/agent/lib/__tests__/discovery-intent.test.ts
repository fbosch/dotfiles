import { expect, test } from "bun:test";
import { type DiscoveryRankingOptions, rankDiscovery } from "../discovery-ranking";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const modelRegistry = await createNativeClassifierRegistry();

const candidates = [
  { name: "alpha", description: "Inspect a failure and identify its cause" },
  { name: "beta", description: "Verify a fix with regression tests" },
  { name: "gamma", description: "Edit prose for clarity" },
];
const cases = [
  {
    name: "a name-shaped query remains exploratory",
    query: "alpha",
    scores: [0.9, 0.8, 0.1],
    expected: ["alpha", "beta"],
  },
  {
    name: "a paraphrased task can find complementary matches",
    query: "protect a repair against recurrence",
    scores: [0.75, 0.95, 0.1],
    expected: ["beta", "alpha"],
  },
  {
    name: "an unrelated task returns no capabilities",
    query: "send an invoice",
    scores: [0.1, 0.2, 0.3],
    expected: [],
  },
];

// Contract fixtures exercise routing and score handling, not provider relevance quality.
for (const kind of ["tool", "skill"] as const) {
  for (const fixture of cases) {
    test(`${kind} exploration: ${fixture.name}`, async () => {
      let calls = 0;
      const result = await rankDiscovery(
        candidates,
        [{ name: "gamma", score: 10 }],
        fixture.query,
        3,
        {
          kind,
          modelRegistry,
          request: async (_registry, input) => {
            calls++;
            expect(Object.keys(input.questions)).toEqual([
              "candidate_0",
              "candidate_1",
              "candidate_2",
            ]);
            return {
              ok: true,
              value: {
                answers: {
                  candidate_0: { type: "bool", probability: fixture.scores[2] ?? 0 },
                  candidate_1: { type: "bool", probability: fixture.scores[0] ?? 0 },
                  candidate_2: { type: "bool", probability: fixture.scores[1] ?? 0 },
                },
              },
            };
          },
        },
      );
      expect(result.rankingSource).toBe("classifier");
      expect(result.matches.map((match) => match.name)).toEqual(fixture.expected);
      expect(calls).toBe(1);
    });
  }
  test(`${kind} lookup requires an exact, case-sensitive visible name`, async () => {
    const options: DiscoveryRankingOptions = {
      kind,
      mode: "lookup",
      modelRegistry,
      request: async () => {
        throw new Error("lookup must not request classification");
      },
    };
    for (const query of ["alp", "ALPHA", "unknown"])
      expect((await rankDiscovery(candidates, [], query, 3, options)).matches).toEqual([]);
    expect((await rankDiscovery(candidates, [], " alpha ", 3, options)).matches).toEqual([
      { name: "alpha", score: 1 },
    ]);
    expect((await rankDiscovery(candidates.slice(1), [], "alpha", 3, options)).matches).toEqual([]);
  });
}
