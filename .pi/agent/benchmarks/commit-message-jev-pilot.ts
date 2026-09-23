import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type JevGatewayFailure,
  type JevGatewayFetch,
  requestJevGateway,
} from "../lib/jev-gateway";

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 4;
const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 2_000;
const MAX_FIELD_CHARS = 4_000;
const DEFAULT_SPEC_PATH = ".agents/skills/commit-message/commit-message.eval.yaml";
const DEFAULT_RESULTS_DIR = ".agents/skills/commit-message/.caliper/results/commit-message";
const CASE_ID_PATTERN = /^case_\d+$/u;

export type AdvisoryVerdict = "pass" | "fail" | "uncertain" | "unavailable";

export interface CommitMessagePilotCase {
  readonly id: string;
  readonly sourceResult: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly rubric: string;
  readonly output: string;
  readonly deterministicPass: boolean;
  readonly existingJudgePass: boolean;
}

export interface CommitMessagePilotComparison {
  readonly id: string;
  readonly sourceResult: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly deterministicPass: boolean;
  readonly existingJudgePass: boolean;
  readonly jevScore?: number;
  readonly jevVerdict: AdvisoryVerdict;
  readonly disagreesWithDeterministic: boolean | null;
  readonly disagreesWithExistingJudge: boolean | null;
  readonly falsePass: boolean;
  readonly falseNegative: boolean;
}

export interface CommitMessagePilotReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly model: "typesafe-ai/jev";
  readonly threshold: number;
  readonly timeoutMs: number;
  readonly caseCount: number;
  readonly elapsedMs: number;
  readonly gatewayFailure?: {
    readonly stage: JevGatewayFailure["stage"];
    readonly reason: JevGatewayFailure["reason"];
    readonly httpStatus?: number;
  };
  readonly evaluationFailure?: {
    readonly stage: "evaluation";
    readonly reason: "invalid-evaluation-response";
  };
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly comparisons: readonly CommitMessagePilotComparison[];
}

export interface RunCommitMessageJevPilotOptions {
  readonly modelRegistry: Pick<ModelRegistry, "getProviderAuth">;
  readonly fetch?: JevGatewayFetch;
  readonly signal?: AbortSignal;
  readonly threshold?: number;
  readonly timeoutMs?: number;
}

type RecordValue = Record<string, unknown>;

type LoadedAttempt = {
  readonly sourceResult: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly attempt: number;
  readonly output: string;
  readonly deterministicPass: boolean;
  readonly existingJudgePass: boolean;
};

type SpecTask = {
  readonly id: string;
  readonly name: string;
  readonly expect: string;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function boundedText(value: string): string {
  return value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS - 1)}…`;
}

function requiredNumber(value: number | undefined, name: string): number {
  if (value === undefined || value < 0 || value > 1) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}

function normalizeThreshold(value: number | undefined): number {
  return value === undefined ? DEFAULT_THRESHOLD : requiredNumber(value, "threshold");
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error("timeout must be an integer from 1 to 2000 milliseconds");
  }
  return value;
}

function taskIdForIndex(index: number): string {
  return `task-${String(index + 1).padStart(3, "0")}`;
}

function readSpecTasks(spec: unknown): SpecTask[] {
  if (!isRecord(spec) || !Array.isArray(spec.tasks)) throw new Error("eval spec has no tasks");
  return spec.tasks.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const name = stringValue(value.name);
    const expect = stringValue(value.expect);
    if (name === undefined || expect === undefined) return [];
    return [{ id: taskIdForIndex(index), name, expect }];
  });
}

function attemptFromResult(
  sourceResult: string,
  taskId: string,
  taskName: string,
  value: unknown,
): LoadedAttempt[] {
  if (!isRecord(value) || !Array.isArray(value.attempts)) return [];
  return value.attempts.flatMap((attemptValue, index) => {
    if (!isRecord(attemptValue)) return [];
    const output = stringValue(attemptValue.output);
    const deterministicPass = booleanValue(attemptValue.assert_passed);
    const existingJudgePass = booleanValue(attemptValue.autorater_passed);
    if (output === undefined || deterministicPass === undefined || existingJudgePass === undefined)
      return [];
    return [
      {
        sourceResult,
        taskId,
        taskName,
        attempt: nonNegativeInteger(attemptValue.attempt) ?? index + 1,
        output,
        deterministicPass,
        existingJudgePass,
      },
    ];
  });
}

function pickBoundedAttempts(attempts: readonly LoadedAttempt[], limit: number): LoadedAttempt[] {
  const selected: LoadedAttempt[] = [];
  const usedTasks = new Set<string>();
  const preferredOutcomes = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const;

  for (const [deterministicPass, existingJudgePass] of preferredOutcomes) {
    const candidate = attempts.find(
      (attempt) =>
        attempt.deterministicPass === deterministicPass &&
        attempt.existingJudgePass === existingJudgePass &&
        !usedTasks.has(attempt.taskId),
    );
    if (candidate === undefined) continue;
    selected.push(candidate);
    usedTasks.add(candidate.taskId);
    if (selected.length >= limit) return selected;
  }

  for (const attempt of attempts) {
    if (selected.length >= limit) break;
    if (
      selected.some(
        (candidate) =>
          candidate.sourceResult === attempt.sourceResult &&
          candidate.attempt === attempt.attempt &&
          candidate.taskId === attempt.taskId,
      )
    )
      continue;
    selected.push(attempt);
  }
  return selected;
}

export async function loadCommitMessagePilotCases(options: {
  readonly specPath: string;
  readonly resultPaths: readonly string[];
  readonly limit?: number;
}): Promise<CommitMessagePilotCase[]> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

  const spec = Bun.YAML.parse(await readFile(options.specPath, "utf8")) as unknown;
  const tasks = readSpecTasks(spec);
  const taskNames = new Map(tasks.map((task) => [task.id, task.name]));
  const taskRubrics = new Map(tasks.map((task) => [task.id, task.expect]));
  const attempts: LoadedAttempt[] = [];

  for (const resultPath of options.resultPaths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resultPath, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.task_results)) continue;
    for (const taskValue of parsed.task_results) {
      if (!isRecord(taskValue)) continue;
      const taskId = stringValue(taskValue.task_id);
      if (taskId === undefined) continue;
      const taskName = taskNames.get(taskId);
      const rubric = taskRubrics.get(taskId);
      if (taskName === undefined || rubric === undefined) continue;
      attempts.push(...attemptFromResult(resultPath, taskId, taskName, taskValue));
    }
  }

  const newestFirst = [...attempts].sort(
    (left, right) =>
      right.sourceResult.localeCompare(left.sourceResult) || right.attempt - left.attempt,
  );
  return pickBoundedAttempts(newestFirst, limit).map((attempt) => ({
    id: `${basename(attempt.sourceResult, extname(attempt.sourceResult))}:${attempt.taskId}:attempt-${attempt.attempt}`,
    sourceResult: attempt.sourceResult,
    taskId: attempt.taskId,
    taskName: attempt.taskName,
    rubric: taskRubrics.get(attempt.taskId) ?? "",
    output: attempt.output,
    deterministicPass: attempt.deterministicPass,
    existingJudgePass: attempt.existingJudgePass,
  }));
}

function createJevRequest(cases: readonly CommitMessagePilotCase[]): RecordValue {
  const questions: RecordValue = {};
  for (const [index, pilotCase] of cases.entries()) {
    questions[`case_${index}`] = {
      type: "noul",
      instructions: `Does the candidate output for ${boundedText(pilotCase.taskName)} satisfy the supplied rubric? Judge only the candidate output against the rubric; do not infer unstated requirements.`,
      criteria: {
        true: "The candidate output satisfies all material requirements in the rubric.",
        false: "The candidate output misses or violates one or more material rubric requirements.",
      },
    };
  }

  return {
    state: {
      cases: cases.map((pilotCase) => ({
        id: boundedText(pilotCase.id),
        task: boundedText(pilotCase.taskName),
        rubric: boundedText(pilotCase.rubric),
        candidate_output: boundedText(pilotCase.output),
      })),
    },
    questions,
  };
}

function parseUsage(value: RecordValue): CommitMessagePilotReport["usage"] {
  if (!isRecord(value.usage)) return undefined;
  const inputTokens = nonNegativeInteger(value.usage.input_tokens);
  const outputTokens = nonNegativeInteger(value.usage.output_tokens);
  if (value.usage.input_tokens !== undefined && inputTokens === undefined) return undefined;
  if (value.usage.output_tokens !== undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function parseJevScores(value: unknown, caseCount: number): number[] | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const ids = Object.keys(value.answers);
  if (ids.length !== caseCount || ids.some((id) => !CASE_ID_PATTERN.test(id))) return undefined;

  const scores: number[] = [];
  for (let index = 0; index < caseCount; index += 1) {
    const answer = value.answers[`case_${index}`];
    if (!isRecord(answer) || answer.type !== "noul") return undefined;
    const score = finiteNumber(answer.noul);
    if (score === undefined || score < 0 || score > 1) return undefined;
    scores.push(score);
  }
  return scores;
}

function verdictForScore(score: number, threshold: number): AdvisoryVerdict {
  if (score >= threshold) return "pass";
  if (score <= 1 - threshold) return "fail";
  return "uncertain";
}

function compareCase(
  pilotCase: CommitMessagePilotCase,
  score: number | undefined,
  threshold: number,
): CommitMessagePilotComparison {
  const jevVerdict = score === undefined ? "unavailable" : verdictForScore(score, threshold);
  const jevBoolean = jevVerdict === "pass" ? true : jevVerdict === "fail" ? false : undefined;
  return {
    id: pilotCase.id,
    sourceResult: pilotCase.sourceResult,
    taskId: pilotCase.taskId,
    taskName: pilotCase.taskName,
    deterministicPass: pilotCase.deterministicPass,
    existingJudgePass: pilotCase.existingJudgePass,
    ...(score === undefined ? {} : { jevScore: score }),
    jevVerdict,
    disagreesWithDeterministic:
      jevBoolean === undefined ? null : jevBoolean !== pilotCase.deterministicPass,
    disagreesWithExistingJudge:
      jevBoolean === undefined ? null : jevBoolean !== pilotCase.existingJudgePass,
    falsePass: jevBoolean === true && !pilotCase.deterministicPass,
    falseNegative: jevBoolean === false && pilotCase.deterministicPass,
  };
}

export async function runCommitMessageJevPilot(
  cases: readonly CommitMessagePilotCase[],
  options: RunCommitMessageJevPilotOptions,
): Promise<CommitMessagePilotReport> {
  if (cases.length === 0) throw new Error("pilot requires at least one case");
  if (cases.length > MAX_LIMIT) throw new Error(`pilot supports at most ${MAX_LIMIT} cases`);

  const threshold = normalizeThreshold(options.threshold);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const startedAt = performance.now();
  const gateway = await requestJevGateway(options.modelRegistry, createJevRequest(cases), {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    timeoutMs,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (!gateway.ok) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      model: "typesafe-ai/jev",
      threshold,
      timeoutMs,
      caseCount: cases.length,
      elapsedMs,
      gatewayFailure: {
        stage: gateway.stage,
        reason: gateway.reason,
        ...(gateway.httpStatus === undefined ? {} : { httpStatus: gateway.httpStatus }),
      },
      comparisons: cases.map((pilotCase) => compareCase(pilotCase, undefined, threshold)),
    };
  }

  const scores = parseJevScores(gateway.value, cases.length);
  if (scores === undefined) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      model: "typesafe-ai/jev",
      threshold,
      timeoutMs,
      caseCount: cases.length,
      elapsedMs,
      evaluationFailure: { stage: "evaluation", reason: "invalid-evaluation-response" },
      comparisons: cases.map((pilotCase) => compareCase(pilotCase, undefined, threshold)),
    };
  }

  const response = isRecord(gateway.value) ? gateway.value : {};
  const usage = parseUsage(response);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: "typesafe-ai/jev",
    threshold,
    timeoutMs,
    caseCount: cases.length,
    elapsedMs,
    ...(usage === undefined ? {} : { usage }),
    comparisons: cases.map((pilotCase, index) => compareCase(pilotCase, scores[index], threshold)),
  };
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseBoundedNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function authProfilePath(agentDir: string, profile: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(profile) || profile === "." || profile === "..") {
    throw new Error("auth profile name is invalid");
  }
  return join(agentDir, "auth-profiles", `${profile}.json`);
}

async function createLiveRegistry(profile: string): Promise<ModelRegistry> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const runtime = await ModelRuntime.create({
    authPath: authProfilePath(agentDir, profile),
    modelsPath: join(agentDir, "models.json"),
    refreshOnCreate: false,
  });
  return new ModelRegistry(runtime);
}

function defaultResultPaths(): Promise<string[]> {
  return readdir(DEFAULT_RESULTS_DIR).then((entries) =>
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => join(DEFAULT_RESULTS_DIR, entry)),
  );
}

function usageText(): string {
  return [
    "Usage: bun benchmarks/commit-message-jev-pilot.ts [options]",
    "",
    "Options:",
    "  --result PATH       Use one Caliper result JSON (repeatable)",
    "  --spec PATH         Commit-message eval spec path",
    "  --limit N           Evaluate at most four existing attempts (default: 4)",
    "  --threshold N       Jev pass threshold (default: 0.8)",
    "  --timeout-ms N      Jev request timeout, 1-2000 ms (default: 2000)",
    "  --auth-profile NAME Auth profile (default: fbb)",
    "  --output PATH       Save the comparison report as JSON",
  ].join("\n");
}

function parseCli(argv: readonly string[]): {
  readonly resultPaths: readonly string[];
  readonly specPath: string;
  readonly limit: number;
  readonly threshold: number;
  readonly timeoutMs: number;
  readonly authProfile: string;
  readonly outputPath?: string;
} {
  const resultPaths: string[] = [];
  let specPath = DEFAULT_SPEC_PATH;
  let limit = DEFAULT_LIMIT;
  let threshold = DEFAULT_THRESHOLD;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let authProfile = "fbb";
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usageText());
      process.exit(0);
    }
    const next = argv[index + 1];
    if (argument === "--result" && next !== undefined) {
      resultPaths.push(next);
      index += 1;
    } else if (argument === "--spec" && next !== undefined) {
      specPath = next;
      index += 1;
    } else if (argument === "--limit" && next !== undefined) {
      limit = parsePositiveInteger(next, "limit");
      index += 1;
    } else if (argument === "--threshold" && next !== undefined) {
      threshold = parseBoundedNumber(next, "threshold");
      index += 1;
    } else if (argument === "--timeout-ms" && next !== undefined) {
      timeoutMs = parsePositiveInteger(next, "timeout-ms");
      index += 1;
    } else if (argument === "--auth-profile" && next !== undefined) {
      authProfile = next;
      index += 1;
    } else if (argument === "--output" && next !== undefined) {
      outputPath = next;
      index += 1;
    } else {
      throw new Error(`unknown or incomplete option: ${argument ?? ""}`);
    }
  }

  return {
    resultPaths,
    specPath,
    limit,
    threshold,
    timeoutMs,
    authProfile,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const cli = parseCli(argv);
  const resultPaths = cli.resultPaths.length > 0 ? cli.resultPaths : await defaultResultPaths();
  if (resultPaths.length === 0) throw new Error("no Caliper result JSON files found");
  const cases = await loadCommitMessagePilotCases({
    specPath: cli.specPath,
    resultPaths,
    limit: cli.limit,
  });
  if (cases.length === 0)
    throw new Error("no attempts with both deterministic and existing-judge results found");

  const registry = await createLiveRegistry(cli.authProfile);
  const report = await runCommitMessageJevPilot(cases, {
    modelRegistry: registry,
    threshold: cli.threshold,
    timeoutMs: cli.timeoutMs,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (cli.outputPath !== undefined) await writeFile(cli.outputPath, serialized, "utf8");

  console.log(
    JSON.stringify(
      {
        model: report.model,
        caseCount: report.caseCount,
        elapsedMs: report.elapsedMs,
        gatewayFailure: report.gatewayFailure ?? null,
        evaluationFailure: report.evaluationFailure ?? null,
        comparisons: report.comparisons.map((comparison) => ({
          taskId: comparison.taskId,
          taskName: comparison.taskName,
          deterministic: comparison.deterministicPass,
          existingJudge: comparison.existingJudgePass,
          jev: comparison.jevVerdict,
          jevScore: comparison.jevScore ?? null,
          disagreement:
            comparison.disagreesWithDeterministic === true ||
            comparison.disagreesWithExistingJudge === true,
          falsePass: comparison.falsePass,
          falseNegative: comparison.falseNegative,
        })),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(() => {
    console.error("Jev pilot unavailable; no raw authentication or request details were recorded.");
    process.exitCode = 1;
  });
}
