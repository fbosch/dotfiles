import { FIXTURES, type Fixture } from "./fixtures";

function capture(entries: Record<number, string>, count = 180): string {
  return Array.from(
    { length: count },
    (_, i) => `${(entries[i + 1] ?? `scan ${i + 1}: routine scan continues`).padEnd(71, " ")}\n`,
  ).join("");
}
const failed = FIXTURES.find((fixture) => fixture.id === "failed-command");
if (!failed) throw new Error("Missing failed-command fixture");

export const BROADER_FIXTURES: Fixture[] = [
  failed,
  {
    id: "mcp-readiness",
    kind: "mcp",
    question:
      "Is rollout permitted and which host is approved by the newest observation? Return JSON keys allowed (boolean) and host (string).",
    output: capture({
      1: "Synthetic readiness capture.",
      81: "Observation 1: allowed=true; host=production",
      131: "Observation 2 supersedes 1: allowed=false; host=staging",
      180: "Inspection completed.",
    }),
    exitCode: 0,
    expected: { allowed: false, host: "staging" },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "mcp-operation-error",
    kind: "mcp",
    question:
      "Did export succeed, and what is the exact blocker? Return JSON keys succeeded (boolean) and blocker (string).",
    output: capture({
      1: "Synthetic export attempt.",
      91: "blocker=retention_hold",
      180: "ERROR: export did not succeed because the retention hold is active.",
    }),
    exitCode: 1,
    expected: { succeeded: false, blocker: "retention_hold" },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "mcp-native-offload",
    kind: "mcp",
    question:
      "What is the artifact identifier in the final observation? Return JSON with a single key artifact.",
    output: capture(
      { 1: "Synthetic large capture.", 600: "Final observation: artifact=elm-421" },
      600,
    ),
    exitCode: 0,
    expected: { artifact: "elm-421" },
    previewExpected: false,
    unmarkedEvidence: false,
  },
];
