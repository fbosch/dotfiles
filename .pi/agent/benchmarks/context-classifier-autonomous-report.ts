import type { CompactionOutcome } from "../extensions/context-masking/classifier-compaction";
import type { autonomousProbe } from "./context-classifier-autonomous-agent";
import type { CallMetric } from "./context-classifier-autonomous-client";
import type { scoreRecall } from "./context-classifier-recall-fixtures";
export const ARMS = ["summary-masked", "summary-artifacts", "jev-content"] as const;
export interface CompactRow {
  seed: string;
  arm: string;
  phase: number;
  ms: number;
  bytes: number;
  metrics: CallMetric[];
  outcome: CompactionOutcome | undefined;
}
export interface ProbeRow {
  seed: string;
  arm: string;
  checkpoint: number;
  ms: number;
  score: ReturnType<typeof scoreRecall>;
  turns: number;
  toolCalls: number;
  events: Awaited<ReturnType<typeof autonomousProbe>>["events"];
  exhausted: boolean;
  maxContextBytes: number;
  metrics: CallMetric[];
}

export function autonomousReport(
  root: string,
  seeds: string[],
  orderOffset: number,
  calls: CallMetric[],
  compactions: CompactRow[],
  probes: ProbeRow[],
) {
  return {
    root,
    seeds,
    orderOffset,
    note: "Synthetic-only. Three retain-none SessionManager compactions with approved-value revisions. Native tool-calling probes after checkpoints 1 and 3 are isolated from later compaction input. No supplied searches or prefetch. Shared recall_saved tool, 6 model turns, 8 successful searches, 24000 tool-result characters, 48000 serialized context bytes. 4000-byte checkpoint cap. Masked artifacts exceed the deterministic minimum result size. Not an end-to-end Pi CLI/hook evaluation. Rate-limit waits excluded.",
    totalBilledCost: calls.reduce((n, m) => n + m.cost, 0),
    arms: Object.fromEntries(
      ARMS.map((arm) => {
        const c = compactions.filter((r) => r.arm === arm),
          p = probes.filter((r) => r.arm === arm);
        return [
          arm,
          {
            compactions: c.length,
            accepted: c.filter((r) => r.outcome?.kind === "retained").length,
            fallbacks: c
              .filter((r) => r.outcome?.kind === "fallback")
              .map((r) => ({ phase: r.phase, reason: r.outcome?.reason })),
            truncatedSummaries: c.reduce(
              (n, r) =>
                n +
                r.metrics.filter((m) => m.kind === "summary" && m.stopReason === "length").length,
              0,
            ),
            meanCompactionMs: c.reduce((n, r) => n + r.ms, 0) / c.length,
            compactionCost: c.reduce((n, r) => n + r.metrics.reduce((v, m) => v + m.cost, 0), 0),
            probeCost: p.reduce((n, r) => n + r.metrics.reduce((v, m) => v + m.cost, 0), 0),
            meanWorkflowMs: [...c, ...p].reduce((n, r) => n + r.ms, 0) / seeds.length,
            mainInputTokens: [...c, ...p].reduce(
              (n, r) =>
                n +
                r.metrics.filter((m) => m.kind !== "classifier").reduce((v, m) => v + m.input, 0),
              0,
            ),
            classifierInputTokens: c.reduce(
              (n, r) =>
                n +
                r.metrics.filter((m) => m.kind === "classifier").reduce((v, m) => v + m.input, 0),
              0,
            ),
            checkpoints: Object.fromEntries(
              [1, 3].map((checkpoint) => {
                const r = p.filter((p) => p.checkpoint === checkpoint);
                return [
                  checkpoint,
                  {
                    correct: r.reduce((n, r) => n + r.score.positiveCorrect, 0),
                    total: r.reduce((n, r) => n + r.score.positiveTotal, 0),
                    current: r.reduce((n, r) => n + r.score.currentCorrect, 0),
                    surprise: r.reduce((n, r) => n + r.score.surpriseCorrect, 0),
                    unknownCorrect: r.reduce((n, r) => n + r.score.unknownCorrect, 0),
                    stale: r.reduce((n, r) => n + r.score.staleAnswers, 0),
                    invalid: r.filter((r) => !r.score.valid).length,
                    exhausted: r.filter((r) => r.exhausted).length,
                    searches: r.reduce((n, r) => n + r.toolCalls, 0),
                    toolErrors: r.reduce((n, r) => n + r.events.filter((e) => e.error).length, 0),
                    limited: r.some((r) => r.events.some((e) => e.limited || e.truncated)),
                    skipped: r.reduce((n, r) => n + r.events.reduce((v, e) => v + e.skipped, 0), 0),
                    meanProbeMs: r.reduce((n, r) => n + r.ms, 0) / r.length,
                    inputTokens: r.reduce(
                      (n, r) => n + r.metrics.reduce((v, m) => v + m.input, 0),
                      0,
                    ),
                  },
                ];
              }),
            ),
          },
        ];
      }),
    ),
  };
}
