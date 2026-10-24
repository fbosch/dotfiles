export interface Fixture {
  id: string;
  kind?: "mcp";
  question: string;
  output: string;
  exitCode: number;
  expected: Record<string, string | number | boolean>;
  previewExpected: boolean;
  unmarkedEvidence: boolean;
}

function transcript(entries: Record<number, string>, count = 240, width = 96): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `${(entries[i + 1] ?? `scan ${i + 1}: routine scan continues`).padEnd(width - 1, " ")}\n`,
  ).join("");
}

export const FIXTURES: Fixture[] = [
  {
    id: "visible-diagnostics",
    question:
      "Is rollout permitted, which schema is required, and why was readiness withdrawn? Return JSON keys allowed (boolean), schema (number), cause (string, use the stated machine-readable value).",
    output: transcript({
      1: "Synthetic rollout inspection.",
      81: "CONSTRAINT: schema=7; allowed=false",
      161: "REVISION: cause=stale_cache",
      240: "FINAL: Inspection completed; preceding restrictions apply.",
    }),
    exitCode: 0,
    expected: { allowed: false, schema: 7, cause: "stale_cache" },
    previewExpected: true,
    unmarkedEvidence: false,
  },
  {
    id: "hidden-identifier",
    question: "What is the exact artifact identifier? Return JSON with the single key artifact.",
    output: transcript({
      1: "Synthetic artifact inspection.",
      121: "artifact = cedar-5829",
      240: "Inspection completed.",
    }),
    exitCode: 0,
    expected: { artifact: "cedar-5829" },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "hidden-contradiction",
    question:
      "According to the newest observation, is rollout permitted, and which host is approved? Return JSON keys allowed (boolean) and host (string). Use the newest observation when observations disagree.",
    output: transcript({
      1: "Observation 1: allowed=true; host=production",
      151: "Observation 2 supersedes observation 1: allowed=false; host=staging",
      240: "Observation capture completed.",
    }),
    exitCode: 0,
    expected: { allowed: false, host: "staging" },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "multi-page-completeness",
    question:
      "Compute the sum of all adjustment amounts and the number of adjustment records in the capture. Return JSON keys sum and count, both numbers. Routine scan counters are not adjustments.",
    output: transcript(
      {
        1: "Synthetic adjustment ledger.",
        251: "adjustment amount=17",
        751: "adjustment amount=-8",
        1101: "adjustment amount=23",
        1200: "Ledger capture completed.",
      },
      1200,
      36,
    ),
    exitCode: 0,
    expected: { sum: 32, count: 3 },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "failed-command",
    question:
      "Did the operation succeed, and what is the exact blocker identifier? Return JSON keys succeeded (boolean) and blocker (string).",
    output: transcript({
      1: "Synthetic operation probe.",
      121: "blocker = replica_lag",
      240: "Operation terminated with nonzero exit status.",
    }),
    exitCode: 1,
    expected: { succeeded: false, blocker: "replica_lag" },
    previewExpected: true,
    unmarkedEvidence: false,
  },
  {
    id: "dense-diagnostics",
    question:
      "What is the exact blocker identifier in the capture? Return JSON with the single key blocker.",
    output: Array.from(
      { length: 240 },
      (_, i) =>
        `WARNING: ${i === 120 ? "blocker=missing_replica" : `probe ${i}: degraded synthetic capacity`}\n`,
    ).join(""),
    exitCode: 0,
    expected: { blocker: "missing_replica" },
    previewExpected: false,
    unmarkedEvidence: false,
  },
];

export function checkAnswer(reply: string, expected: Fixture["expected"]) {
  const clean = reply
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  let actual: unknown;
  try {
    actual = JSON.parse(clean);
  } catch {
    return { correct: false, issues: ["invalid-json"] };
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual))
    return { correct: false, issues: ["not-object"] };
  const issues = Object.entries(expected)
    .filter(([key, value]) => Reflect.get(actual, key) !== value)
    .map(([key]) => key);
  return { correct: issues.length === 0, issues };
}
