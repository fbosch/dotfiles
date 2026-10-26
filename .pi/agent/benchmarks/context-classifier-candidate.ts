import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  CLASSIFIER_DEFAULTS,
  type CompactionOutcome,
  classifyCompaction,
} from "../extensions/context-masking/classifier-compaction";
import { codingCases, scoreCode } from "./context-compaction-task-fixtures";
import {
  composeInput,
  INPUT_TOKEN_CEILING,
  prepareTaskHistory,
  SYSTEM,
} from "./context-compaction-tasks";

const ARMS = ["summary", "jev-metadata", "jev-content"] as const;
type Arm = (typeof ARMS)[number];
interface Metric {
  kind: string;
  ms: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}
interface Row {
  case: string;
  arm: Arm;
  success: boolean;
  checksPassed: number;
  checksTotal: number;
  criticalViolations: number;
  fallback: string | undefined;
  budgetFallback: boolean;
  promptTokens: number;
  compactionMs: number;
  continuationMs: number;
  endToEndMs: number;
  operationalCost: number;
  billedCost: number;
  outcome: CompactionOutcome | undefined;
  metrics: Metric[];
}

async function main() {
  const [casesArg = "routing,retry,journal", seed = "pilot-1"] = process.argv.slice(2);
  const selected = casesArg.split(",");
  const distractors = Number(process.env.CLASSIFIER_DISTRACTORS ?? "0");
  if (!Number.isInteger(distractors) || distractors < 0 || distractors > 30)
    throw new Error("Invalid distractor count");
  const tasks = codingCases(seed)
    .filter((task) => selected.includes(task.name))
    .map((task) => ({
      ...task,
      history: [
        ...(distractors
          ? [
              {
                kind: "assistant" as const,
                text: "The following background health checks are closed, successful, and unrelated to the current coding task. Their outputs and addresses are not needed to continue.",
              },
            ]
          : []),
        ...Array.from({ length: distractors }, (_, i) => ({
          kind: "tool" as const,
          source: `reports/closed-health-${i}.txt`,
          text: `Closed background health check ${i}: successful. No findings, constraints, dependencies or pending work for the current task.`,
        })),
        ...task.history,
      ],
    }));
  if (tasks.length !== selected.length) throw new Error("Unknown or duplicate cases");
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel("vercel-ai-gateway", "openai/gpt-4.1-mini");
  const jev = runtime.getModelOfType(
    "classifier",
    CLASSIFIER_DEFAULTS.provider,
    CLASSIFIER_DEFAULTS.model,
  );
  if (!model || !jev) throw new Error("Required chat or classifier model unavailable");
  const root = await mkdtemp(join(tmpdir(), "classifier-candidate-"));
  console.error(JSON.stringify({ root, seed }));
  const gap = Number(process.env.COMPACTION_CHAT_GAP_MS ?? "15000");
  if (!Number.isFinite(gap) || gap < 0) throw new Error("Invalid COMPACTION_CHAT_GAP_MS");
  let lastChat = -Infinity,
    waitedMs = 0;
  const rows: Row[] = [];
  const calls: Metric[] = [];
  const chat = async (
    text: string,
    systemPrompt: string,
    maxTokens: number,
    kind: string,
    metrics: Metric[],
  ) => {
    const pause = gap - (performance.now() - lastChat);
    if (pause > 0) {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, pause));
      waitedMs += performance.now() - start;
    }
    lastChat = performance.now();
    const start = performance.now();
    const response = await runtime.completeSimple(
      model,
      { systemPrompt, messages: [{ role: "user", content: text, timestamp: 0 }] },
      { maxTokens },
    );
    const u = response.usage;
    const metric = {
      kind,
      ms: performance.now() - start,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      cost: u.cost.total,
    };
    metrics.push(metric);
    calls.push(metric);
    await writeFile(join(root, "calls.json"), JSON.stringify(calls, null, 2));
    if (
      response.stopReason === "error" ||
      response.stopReason === "aborted" ||
      (response.stopReason === "length" && kind !== "calibration")
    )
      throw new Error(`${kind}: ${response.errorMessage ?? response.stopReason}`);
    return {
      text: response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
      metric,
    };
  };
  for (const task of tasks) {
    const prepared = await prepareTaskHistory(task, join(root, task.name));
    for (const [armIndex, arm] of ARMS.entries()) {
      // Rotate order per task to reduce a fixed provider-order bias.
      const activeArm = ARMS[(armIndex + tasks.indexOf(task)) % ARMS.length] ?? arm;
      const metrics: Metric[] = [];
      const start = performance.now(),
        waited = waitedMs;
      let outcome: CompactionOutcome | undefined;
      if (activeArm !== "summary") {
        outcome = await classifyCompaction(
          {
            branch: prepared.branch,
            messages: prepared.messages,
            instructions: task.goal,
          },
          {
            ...CLASSIFIER_DEFAULTS,
            enabled: true,
            includeContent: activeArm === "jev-content",
            maxOutputBytes: 4_000,
          },
          {
            artifactRoot: prepared.artifactRoot,
            classify: async (request, signal) => {
              const started = performance.now();
              const response = await runtime.classify(jev, request, signal ? { signal } : {});
              if (response.usage) {
                const u = response.usage;
                const metric = {
                  kind: "classifier",
                  ms: performance.now() - started,
                  input: u.input,
                  output: u.output,
                  cacheRead: u.cacheRead,
                  cacheWrite: u.cacheWrite,
                  cost: u.cost.total,
                };
                metrics.push(metric);
                calls.push(metric);
              } else throw new Error("Classifier returned no measured usage");
              return response;
            },
          },
        );
        if (
          outcome.reason === "classifier-error" ||
          outcome.reason === "classifier-request-failed" ||
          outcome.reason === "invalid-classifier-answer"
        )
          throw new Error(`Classifier infrastructure failure: ${outcome.reason}; ${root}`);
      }
      const summarize = async () =>
        (
          await chat(
            `Summarize in at most 250 words.\n\n${prepared.maskedHistory}`,
            "Compress coding-agent history into current goal, critical constraints, superseded decisions and unfinished work. Never invent unavailable values.",
            700,
            "summary",
            metrics,
          )
        ).text;
      let memory = outcome?.kind === "retained" ? outcome.text : await summarize();
      let compactionMs = performance.now() - start - (waitedMs - waited);
      let input = composeInput(task, memory, "", prepared.continuation.text);
      let calibration = await chat(input, SYSTEM, 16, "calibration", metrics);
      let promptTokens =
        calibration.metric.input + calibration.metric.cacheRead + calibration.metric.cacheWrite;
      let budgetFallback = false;
      if (promptTokens > INPUT_TOKEN_CEILING && outcome?.kind === "retained") {
        budgetFallback = true;
        const fallbackStarted = performance.now(),
          fallbackWait = waitedMs;
        memory = await summarize();
        compactionMs += performance.now() - fallbackStarted - (waitedMs - fallbackWait);
        input = composeInput(task, memory, "", prepared.continuation.text);
        calibration = await chat(input, SYSTEM, 16, "calibration", metrics);
        promptTokens =
          calibration.metric.input + calibration.metric.cacheRead + calibration.metric.cacheWrite;
      }
      if (promptTokens > INPUT_TOKEN_CEILING)
        throw new Error("Fallback prompt exceeds shared token ceiling");
      const completed = await chat(input, SYSTEM, 1_200, "continuation", metrics);
      if (
        completed.metric.input + completed.metric.cacheRead + completed.metric.cacheWrite !==
        promptTokens
      )
        throw new Error("Calibration count mismatch");
      const scored = scoreCode(task, completed.text);
      const row: Row = {
        case: task.name,
        arm: activeArm,
        success: scored.taskSuccess,
        checksPassed: scored.passed,
        checksTotal: scored.total,
        criticalViolations: scored.criticalViolations,
        fallback: outcome?.kind === "fallback" ? outcome.reason : undefined,
        budgetFallback,
        promptTokens,
        compactionMs,
        continuationMs: completed.metric.ms,
        endToEndMs: compactionMs + completed.metric.ms + prepared.continuationLookupMs,
        operationalCost: metrics
          .filter((m) => m.kind !== "calibration")
          .reduce((sum, m) => sum + m.cost, 0),
        billedCost: metrics.reduce((sum, m) => sum + m.cost, 0),
        outcome,
        metrics,
      };
      rows.push(row);
      await writeFile(
        join(root, task.name, `${activeArm}.json`),
        JSON.stringify({ row, memory, code: completed.text, scored }, null, 2),
      );
      await writeFile(join(root, "results.json"), JSON.stringify({ root, seed, rows }, null, 2));
      console.error(
        JSON.stringify({
          case: task.name,
          arm: activeArm,
          success: row.success,
          promptTokens,
          fallback: row.fallback,
          decisions: outcome?.decisions.map((d) => ({ action: d.action, forced: d.forced })),
        }),
      );
    }
  }
  const report = {
    root,
    seed,
    distractors,
    tokenCeiling: INPUT_TOKEN_CEILING,
    candidateOutputByteCap: 4_000,
    note: "Synthetic coding continuations, not longitudinal agents. Same continuation retrieval and token ceiling. Rate-limit waits excluded. Failed candidate work and fallback summaries included in cost. Classifier source is the extension module, not a benchmark reimplementation.",
    totalBilledCost: calls.reduce((sum, c) => sum + c.cost, 0),
    arms: Object.fromEntries(
      ARMS.map((arm) => {
        const r = rows.filter((row) => row.arm === arm);
        return [
          arm,
          {
            runs: r.length,
            tasksPassed: r.filter((row) => row.success).length,
            checksPassed: r.reduce((n, row) => n + row.checksPassed, 0),
            checksTotal: r.reduce((n, row) => n + row.checksTotal, 0),
            criticalViolations: r.reduce((n, row) => n + row.criticalViolations, 0),
            acceptedCandidates: r.filter(
              (row) => row.outcome?.kind === "retained" && !row.budgetFallback,
            ).length,
            fallbacks: r.filter((row) => row.fallback || row.budgetFallback).length,
            meanPromptTokens: r.reduce((n, row) => n + row.promptTokens, 0) / r.length,
            meanEndToEndMs: r.reduce((n, row) => n + row.endToEndMs, 0) / r.length,
            operationalCost: r.reduce((n, row) => n + row.operationalCost, 0),
            billedCost: r.reduce((n, row) => n + row.billedCost, 0),
            classifierRequests: r.reduce(
              (n, row) => n + (row.outcome?.requestBytes.length ?? 0),
              0,
            ),
            classifierRequestBytes: r.flatMap((row) => row.outcome?.requestBytes ?? []),
          },
        ];
      }),
    ),
  };
  await writeFile(join(root, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
