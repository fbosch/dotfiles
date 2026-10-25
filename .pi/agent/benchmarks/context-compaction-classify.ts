import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type Block,
  BUDGETS,
  buildCase,
  type CaseScore,
  type CompactionCase,
  coverage,
  fit,
  readEntries,
  STRATEGIES,
  sessionFiles,
  summarize,
} from "./context-compaction-eval";

// Classifier-selected verbatim compaction, scored on the same labels as context-compaction-eval.
// Sends block text from recorded sessions to the chosen classifier provider; output holds only
// scores and ratios. Usage: bun context-compaction-classify.ts <provider/model> [sample] [seed]

const MAX_BLOCK_CHARS = 6_000;
const MAX_NEIGHBOR_CHARS = 1_200;
const CONCURRENCY = 8;

const clip = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text.slice(0, Math.floor(max * 0.7))}\n[…]\n${text.slice(-Math.floor(max * 0.3))}`;

export const QUESTIONS: Parameters<ModelRuntime["classify"]>[1]["questions"] = {
  constraint: {
    type: "bool",
    instructions:
      "Does the BLOCK contain a user requirement, preference, or constraint that should still apply to later work?",
    criteria: {
      true: "States something later work must respect",
      false: "No lasting requirement or preference",
    },
  },
  decision: {
    type: "bool",
    instructions:
      "Does the BLOCK record a decision, conclusion, or finding that later work depends on, such as a chosen approach, a root cause, or a specific file, identifier, or value to use?",
    criteria: {
      true: "Records something later work builds on",
      false: "Routine exploration, retries, or narration",
    },
  },
  unresolved: {
    type: "bool",
    instructions: "Does the BLOCK describe work that was started or promised but not finished?",
    criteria: { true: "Open or pending work", false: "Nothing left open" },
  },
  relevance: {
    type: "score",
    instructions:
      "How likely is it that continuing CURRENT_REQUEST will need the specific details in the BLOCK (names, paths, values, errors), not just its gist?",
    criteria: ["not needed", "possibly useful", "likely needed", "certainly needed"],
  },
};

export interface BlockScores {
  constraint: number;
  decision: number;
  unresolved: number;
  /** Expected relevance level divided by 3, from 0 to 1. */
  relevance: number;
}

export const SCORINGS: Record<string, (s: BlockScores) => number> = {
  relevance: (s) => s.relevance,
  "any-bool": (s) => Math.max(s.constraint, s.decision, s.unresolved),
  combined: (s) => 0.5 * s.relevance + 0.5 * Math.max(s.constraint, s.decision, s.unresolved),
};

/** Value-per-character selection, emitted in original order (LRE-style). */
export function selectByScore(
  blocks: readonly Block[],
  scores: readonly number[],
  budget: number,
): Block[] {
  const ranked = blocks
    .map((block, i) => ({ block, density: (scores[i] ?? 0) / Math.max(200, block.text.length) }))
    .sort((a, b) => b.density - a.density)
    .map((r) => r.block);
  return fit(ranked, budget).sort((a, b) => a.index - b.index);
}

// Deterministic sample so reruns and other models see the same compactions.
function shuffle<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

export function latencyStats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return {
    count: sorted.length,
    total: sorted.reduce((sum, value) => sum + value, 0),
    median: percentile(0.5),
    p95: percentile(0.95),
  };
}

async function main(): Promise<void> {
  const [modelRef = "openrouter/typesafe/jev-1.14", sampleArg = "50", seedArg = "1"] =
    process.argv.slice(2);
  const [provider = "", ...idParts] = modelRef.split("/");
  const runtime = await ModelRuntime.create();
  const model = runtime
    .getModelsOfType("classifier", provider)
    .find((m) => m.id === idParts.join("/"));
  if (model === undefined) throw new Error(`Classifier not found: ${modelRef}`);

  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const cases: CompactionCase[] = [];
  for await (const path of sessionFiles(join(agentDir, "sessions"))) {
    const entries = await readEntries(path);
    if (!entries.some((e) => e.type === "compaction")) continue;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const entry of entries) {
      const c = entry.type === "compaction" ? buildCase(entries, byId, entry) : undefined;
      if (c !== undefined && c.needed.size > 0) cases.push(c);
    }
  }
  const sample = shuffle(cases, Number(seedArg)).slice(0, Number(sampleArg));

  const classifierRequestMs: number[] = [];
  const classifierCaseMs: number[] = [];
  const recencySelectionMs: number[] = [];
  const classifierSelectionMs: number[] = [];
  let calls = 0;
  let failures = 0;
  let lastError = "";
  let cost = 0;
  let inputTokens = 0;
  const scores: CaseScore[] = [];
  for (const c of sample) {
    const caseStarted = performance.now();
    const blockScores: BlockScores[] = new Array(c.blocks.length);
    const queue = c.blocks.map((_, i) => i);
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const block = c.blocks[i] as Block;
        const requestStarted = performance.now();
        const result = await runtime.classify(model, {
          state: {
            CURRENT_REQUEST: clip(c.currentRequest, MAX_NEIGHBOR_CHARS),
            PREVIOUS_BLOCK: clip(c.blocks[i - 1]?.text ?? "", MAX_NEIGHBOR_CHARS),
            BLOCK: clip(block.text, MAX_BLOCK_CHARS),
            NEXT_BLOCK: clip(c.blocks[i + 1]?.text ?? "", MAX_NEIGHBOR_CHARS),
            BLOCK_KIND: block.kind,
            POSITION: `block ${i + 1} of ${c.blocks.length}, oldest first`,
          },
          questions: QUESTIONS,
        });
        classifierRequestMs.push(performance.now() - requestStarted);
        calls++;
        cost += result.usage?.cost.total ?? 0;
        inputTokens += result.usage?.input ?? 0;
        const a = result.answers;
        const bool = (key: string) => {
          const answer = a[key];
          return answer?.type === "bool" ? answer.probability : 0.5;
        };
        const rel = a.relevance;
        if (result.stopReason !== "stop" || rel?.type !== "score") {
          failures++;
          lastError = result.errorMessage ?? "missing relevance answer";
        }
        // Failed calls score as uncertain rather than unimportant.
        blockScores[i] = {
          constraint: bool("constraint"),
          decision: bool("decision"),
          unresolved: bool("unresolved"),
          relevance: rel?.type === "score" ? rel.score / 3 : 0.5,
        };
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Scores from failed calls are neutral placeholders, so a mostly failing run is meaningless.
    if (failures > calls * 0.05)
      throw new Error(`${failures}/${calls} classifier calls failed: ${lastError.slice(0, 300)}`);

    classifierCaseMs.push(performance.now() - caseStarted);
    // Repeat local selectors to make sub-millisecond timings measurable; exclude scoring.
    const measure = (run: () => unknown): number => {
      const started = performance.now();
      for (let repeat = 0; repeat < 100; repeat++) run();
      return (performance.now() - started) / 100;
    };
    const budget = c.summary.length;
    recencySelectionMs.push(measure(() => STRATEGIES.recency?.(c.blocks, budget, c.needed)));
    const combined = blockScores.map(SCORINGS.combined ?? (() => 0));
    classifierSelectionMs.push(measure(() => selectByScore(c.blocks, combined, budget)));
    const covered: Record<string, number> = { summary: coverage(c.summary, c.needed) };
    const join = (blocks: readonly Block[]) => blocks.map((b) => b.text).join("\n");
    for (const multiple of BUDGETS) {
      for (const name of ["recency", "oracle"] as const) {
        covered[`${name}@${multiple}x`] = coverage(
          join((STRATEGIES[name] ?? (() => []))(c.blocks, budget * multiple, c.needed)),
          c.needed,
        );
        if (multiple > 1)
          covered[`summary+${name}@${multiple}x`] = coverage(
            `${c.summary}\n${join((STRATEGIES[name] ?? (() => []))(c.blocks, budget * (multiple - 1), c.needed))}`,
            c.needed,
          );
      }
      for (const [name, scoring] of Object.entries(SCORINGS)) {
        const values = blockScores.map(scoring);
        covered[`clf-${name}@${multiple}x`] = coverage(
          join(selectByScore(c.blocks, values, budget * multiple)),
          c.needed,
        );
        if (multiple > 1)
          covered[`summary+clf-${name}@${multiple}x`] = coverage(
            `${c.summary}\n${join(selectByScore(c.blocks, values, budget * (multiple - 1)))}`,
            c.needed,
          );
      }
    }
    scores.push({
      needed: c.needed.size,
      budget,
      summarizedChars: c.blocks.reduce((sum, block) => sum + block.text.length, 0),
      blocks: c.blocks.length,
      covered,
    });
    console.error(
      `case ${scores.length}/${sample.length}: ${c.blocks.length} blocks, ${calls} calls, ${failures} failed, $${cost.toFixed(4)}`,
    );
  }
  const report = {
    model: modelRef,
    sample: sample.length,
    calls,
    failures,
    inputTokens,
    cost,
    timingMs: {
      classifierRequest: latencyStats(classifierRequestMs),
      classifierCompactionAtConcurrency8: latencyStats(classifierCaseMs),
      recencySelection: latencyStats(recencySelectionMs),
      classifierSelectionOnly: latencyStats(classifierSelectionMs),
    },
    caseScores: scores,
    ...summarize(scores),
  };
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    `/tmp/context-compaction-classify-${model.id.replace(/\W/gu, "_")}.json`,
    `${JSON.stringify(report)}\n`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
