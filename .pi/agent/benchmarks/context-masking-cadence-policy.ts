import { createHash } from "node:crypto";

export const CADENCE_ARMS = ["ten-turn", "token-budget"] as const;
export type CadenceArm = typeof CADENCE_ARMS[number];
export const CADENCE_SETTINGS = {
  turns: 30, intervalTurns: 10, protectRecentTurns: 10, tokenBatch: 4_000,
  minResultChars: 800, historyBytes: 12_000, maxRequestBytes: 24_000,
  minBatchSavedTokens: 100, probeTurns: [20, 25, 30] as readonly number[],
};
export interface Observation {
  id: string;
  turn: number;
  tool: string;
  args: Record<string, string>;
  text: string;
  isError: boolean;
  pinned: boolean;
}
export interface ReplayTurn {
  number: number;
  direction?: string;
  observation: Observation;
}
export interface ProbeFact { key: string; question: string; expected: string }
export interface CadenceFixture {
  seed: string;
  workload: string;
  goal: string;
  turns: ReplayTurn[];
  probes: Record<number, ProbeFact[]>;
}
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const textTokens = (text: string) => Math.ceil(Buffer.byteLength(text) / 4);
export function argumentKey(observation: Observation): string {
  return JSON.stringify([observation.tool, Object.entries(observation.args).sort(([a], [b]) => a.localeCompare(b))]);
}
export function eligibleObservations(
  observations: readonly Observation[], turn: number, assessed: ReadonlySet<string>,
): Observation[] {
  return observations.filter(observation => {
    if (assessed.has(observation.id) || observation.turn > turn - CADENCE_SETTINGS.protectRecentTurns ||
      observation.text.length < CADENCE_SETTINGS.minResultChars || observation.pinned) return false;
    return !observation.isError || observations.some(later =>
      later.turn > observation.turn && later.turn <= turn && !later.isError &&
      argumentKey(later) === argumentKey(observation));
  });
}
export function shouldAssess(arm: CadenceArm, turn: number, candidates: readonly Observation[]): boolean {
  if (!candidates.length) return false;
  return arm === "ten-turn" ? turn % CADENCE_SETTINGS.intervalTurns === 0
    : candidates.reduce((total, candidate) => total + textTokens(candidate.text), 0) >= CADENCE_SETTINGS.tokenBatch;
}
export type HistorySnapshot = {
  goal: string;
  latestUserDirection: string;
  recentTurns: Array<{ number: number; direction?: string; tool: string; args: Record<string, string>; text: string; isError: boolean }>;
  omittedRecentTurns: number;
  compaction: "disabled in both arms";
};
export function historySnapshot(fixture: CadenceFixture, turn: number): HistorySnapshot {
  const seen = fixture.turns.filter(item => item.number <= turn);
  const recent = seen.slice(-CADENCE_SETTINGS.protectRecentTurns);
  const selected: HistorySnapshot["recentTurns"] = [];
  let bytes = 0;
  for (const item of [...recent].reverse()) {
    const row = { number: item.number, ...(item.direction ? { direction: item.direction } : {}),
      tool: item.observation.tool, args: item.observation.args, text: item.observation.text, isError: item.observation.isError };
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > CADENCE_SETTINGS.historyBytes) break;
    selected.unshift(row); bytes += size;
  }
  return {
    goal: fixture.goal,
    latestUserDirection: [...seen].reverse().find(item => item.direction)?.direction ?? fixture.goal,
    recentTurns: selected, omittedRecentTurns: recent.length - selected.length, compaction: "disabled in both arms",
  };
}
export function makeFixture(seedIndex: number): CadenceFixture {
  if (!Number.isInteger(seedIndex) || seedIndex < 0 || seedIndex > 2) throw Error("Seed index must be 0, 1, or 2");
  const seed = "cadence-" + (seedIndex + 1);
  const workloads = ["small-observations", "bursty-observations", "mixed-observations"];
  const value = (name: string) => name + "-" + hash(seed + name).slice(0, 10);
  const a = value("migration"), oldB = value("old-route"), newB = value("approved-route"), owner = value("owner-æøå");
  const directions: Record<number, string> = {
    1: "Investigate migration A. Establish its checksum and keep the schema contract available until the migration work ends.",
    13: "Switch to routing incident B. Establish its current route. The earlier migration evidence may be needed when we return.",
    21: "Return to migration A and compare it with routing B. Recover exact earlier evidence when necessary.",
    24: "The next routing report supersedes the previous route approval. Use the new approval from now on.",
    26: "The schema contract is no longer an active reference. Preserve exact originals for future recovery.",
  };
  const turns: ReplayTurn[] = [];
  for (let number = 1; number <= CADENCE_SETTINGS.turns; number++) {
    const bytes = seedIndex === 0 ? 1_100 : seedIndex === 1 ? (number % 5 === 0 ? 9_000 : 1_100)
      : number % 3 === 0 ? 4_800 : 1_500;
    const fact = number === 2 ? "Migration A checksum: " + a
      : number === 3 ? "ACTIVE CONTRACT: schema requires tenant_æøå."
      : number === 14 ? "Routing B approved route: " + oldB
      : number === 18 ? "Migration audit owner: " + owner
      : number === 24 ? "Routing B NEW approved route (supersedes earlier approval): " + newB
      : number === 8 ? "Verification failed: migration suite has an unresolved assertion."
      : number === 16 ? "Verification succeeded: the identical migration suite now passes."
      : "Diagnostic sample " + number + ": no new decision.";
    const lines = [fact];
    while (lines.join("\n").length < bytes) {
      const index = lines.length;
      lines.push("trace " + number + "/" + index + " " + hash(seed + "/" + number + "/" + index).slice(0, 40));
    }
    const verify = number === 8 || number === 16;
    turns.push({ number, ...(directions[number] ? { direction: directions[number] } : {}),
      observation: { id: "observation-" + number, turn: number, tool: verify ? "verify" : "read",
        args: verify ? { suite: "migration" } : { path: number === 2 ? "migration-checksum.txt"
          : number === 3 ? "schema-contract.txt" : number === 14 || number === 24 ? "routing-approval.txt"
          : number === 18 ? "migration-audit.txt" : "diagnostic-" + number + ".txt" },
        text: lines.join("\n"), isError: number === 8, pinned: number === 3 } });
  }
  const factA = { key: "migration", question: "What exact checksum did migration A report?", expected: a };
  return { seed, workload: workloads[seedIndex] ?? "", goal: "Investigate migration and routing incidents using exact recorded evidence. Later explicit approvals supersede earlier ones. This is a synthetic read-only replay.",
    turns, probes: {
      20: [factA, { key: "route", question: "What is the latest approved route for routing B?", expected: oldB }],
      25: [factA, { key: "route", question: "What is the latest approved route for routing B?", expected: newB }],
      30: [factA, { key: "route", question: "What is the latest approved route for routing B?", expected: newB },
        { key: "owner", question: "What is the exact migration audit owner identifier?", expected: owner }],
    } };
}
function isAnswerObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function scoreProbe(facts: readonly ProbeFact[], answer: string) {
  let actual: unknown;
  try { actual = JSON.parse(answer); } catch { actual = undefined; }
  const object = isAnswerObject(actual) ? actual : undefined;
  const checks = facts.map(fact => {
    const value = object && Object.hasOwn(object, fact.key) ? object[fact.key] : null;
    return { key: fact.key, expected: fact.expected, actual: value, correct: value === fact.expected };
  });
  return { valid: object !== undefined, correct: checks.filter(check => check.correct).length, total: facts.length, checks };
}
