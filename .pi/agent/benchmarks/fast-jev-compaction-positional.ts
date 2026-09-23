#!/usr/bin/env bun
/**
 * Positional retention check for facts embedded in long synthetic tool results.
 * Only the Jev compactor runs; follow-ups use the paired benchmark's Luna model.
 */

import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify((await import("node:child_process")).execFile);
const REPO = resolve(dirname(import.meta.path), "../../..");
const OURS_MODULE = resolve(REPO, ".pi/agent/extensions/fast-jev-compaction/index.ts");
const MODEL_REFERENCE = "openai-codex/gpt-5.6-luna";
const REPORT_ROOT = join(
  process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? tmpdir(), ".local", "state"),
  "dotfiles",
  "pi-benchmarks",
  "fast-jev-compaction-live",
  "positional",
);
const JEv_TIMEOUT_MS = 2_400;
const FOLLOWUP_TIMEOUT_MS = 60_000;
const CHILD_TIMEOUT_MS = 140_000;
const TOTAL_BUDGET_MS = 840_000;
const MAX_COMPACTIONS = 6;
const MAX_FOLLOWUPS = 12;
const FOLLOWUPS_PER_COMPACTION = 2;
const MAX_JEV_HTTP_REQUESTS = 6;
const MAX_RUNS_PER_PASS = 3;
const RESERVE_TOKENS = 8_000;
const ANSWER_MAX_TOKENS = 1_200;
const MAX_JEV_HTTP_PER_COMPACTION = 1;
const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";
const TRUNCATED_RESULT_HEAD_CHARS = 240;
const FACT_VALUES = {
  artifact_version: "5.7.3",
  verification_command: "quartz verify --abi",
  publish_command: "quartz publish --channel edge",
  manifest_path: "./dist/quartz/manifest.json",
} as const;
const FACT_RECORD = `Registry record: ${JSON.stringify(FACT_VALUES)}`;
const ROUTINE_FILLER =
  "Synthetic generated preview row; deterministic fictional boilerplate that is safe to recreate from its template. No host files, user data, credentials, or external project content are present.\n";

export const POSITIONAL_BENCHMARK_LIMITS = {
  maxCompactions: MAX_COMPACTIONS,
  maxFollowups: MAX_FOLLOWUPS,
  followupsPerCompaction: FOLLOWUPS_PER_COMPACTION,
  maxJevHttpRequests: MAX_JEV_HTTP_REQUESTS,
  maxJevHttpPerCompaction: MAX_JEV_HTTP_PER_COMPACTION,
  maxCompactionsPerPass: MAX_RUNS_PER_PASS,
  jevTimeoutMs: JEv_TIMEOUT_MS,
  followupTimeoutMs: FOLLOWUP_TIMEOUT_MS,
  childTimeoutMs: CHILD_TIMEOUT_MS,
  totalBudgetMs: TOTAL_BUDGET_MS,
  sequentialCompactions: true,
  retries: 0,
  summaryModelFallbackRequests: 0,
} as const;

export type FactPosition = "beginning" | "middle" | "end";
type JsonRecord = Record<string, unknown>;
type Scalar = string | boolean;

interface PositionalTask {
  readonly id: string;
  readonly question: string;
  readonly schema: JsonRecord;
  readonly oracle:
    | { readonly kind: "facts"; readonly fields: Readonly<Record<string, Scalar>> }
    | {
        readonly kind: "actions";
        readonly steps: readonly string[];
        readonly mustNot: readonly string[];
      };
}

export interface PositionalFixture {
  readonly name: string;
  readonly position: FactPosition;
  readonly repetition: 1 | 2;
  readonly targetCallId: string;
  readonly targetResult: string;
  readonly factRecord: string;
  readonly oldMessages: readonly unknown[];
  readonly tailMessages: readonly unknown[];
  readonly tasks: readonly [PositionalTask, PositionalTask];
}

function message(role: "user" | "assistant", text: string): JsonRecord {
  return { role, content: [{ type: "text", text }] };
}

function toolPair(id: string, path: string, result: string): unknown[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Inspecting a synthetic generated deployment artifact." },
        { type: "toolCall", id, name: "read", arguments: { path } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: id,
      content: [{ type: "text", text: result }],
      isError: false,
    },
  ];
}

function resultForPosition(position: FactPosition): string {
  if (position === "beginning") return `${FACT_RECORD}\n${ROUTINE_FILLER.repeat(22)}`;
  if (position === "middle")
    return `${ROUTINE_FILLER.repeat(8)}${FACT_RECORD}\n${ROUTINE_FILLER.repeat(14)}`;
  return `${ROUTINE_FILLER.repeat(22)}${FACT_RECORD}`;
}

function routineResult(index: number): string {
  return [
    `Synthetic generated listing ${index}; entries are fictional and repeatable.`,
    ROUTINE_FILLER.repeat(18),
  ].join("\n");
}

function makeTaskSchema(properties: JsonRecord, required: readonly string[]): JsonRecord {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function makeFixture(position: FactPosition, repetition: 1 | 2): PositionalFixture {
  const targetResult = resultForPosition(position);
  const oldMessages: unknown[] = [
    message(
      "user",
      "Prepare the fictional Quartz edge release. Read the deployment registry record and retain the exact version, verification command, publish command, and manifest path for the follow-up. ABI verification must pass before publishing.",
    ),
  ];
  const routinePaths = [
    "packages/quartz/generated/preview.ts",
    "packages/quartz/generated/schema.ts",
    "packages/quartz/build/preview.json",
    "packages/quartz/release-notes.generated.md",
  ];
  for (let index = 0; index < routinePaths.length; index += 1) {
    oldMessages.push(
      ...toolPair(`routine-${index + 1}`, routinePaths[index]!, routineResult(index + 1)),
    );
  }
  oldMessages.push(
    ...toolPair("target-registry", "packages/quartz/release-registry.json", targetResult),
  );

  const factsTask: PositionalTask = {
    id: "registry-facts",
    question:
      "Return the exact artifact version, verification command, publish command, and manifest path from the synthetic registry record. Use the supplied field names and return JSON only.",
    schema: makeTaskSchema(
      {
        artifact_version: { type: "string" },
        verification_command: { type: "string" },
        publish_command: { type: "string" },
        manifest_path: { type: "string" },
      },
      Object.keys(FACT_VALUES),
    ),
    oracle: { kind: "facts", fields: FACT_VALUES },
  };
  const actionTask: PositionalTask = {
    id: "safe-release-actions",
    question:
      "Using the registry record, return the exact required command sequence and a must_not entry stating that publishing must not happen before verification succeeds. Return JSON only.",
    schema: makeTaskSchema(
      {
        steps: { type: "array", items: { type: "string" } },
        must_not: { type: "array", items: { type: "string" } },
      },
      ["steps", "must_not"],
    ),
    oracle: {
      kind: "actions",
      steps: [FACT_VALUES.verification_command, FACT_VALUES.publish_command],
      mustNot: ["publish before verification succeeds"],
    },
  };
  return {
    name: `${position}-rep-${repetition}`,
    position,
    repetition,
    targetCallId: "target-registry",
    targetResult,
    factRecord: FACT_RECORD,
    oldMessages,
    tailMessages: [
      message("assistant", "The synthetic release remains staged; no commands have been executed."),
      message(
        "user",
        "Continue from the compacted history and report the registry facts and safe next actions.",
      ),
    ],
    tasks: [factsTask, actionTask],
  };
}

export function makePositionalFixtures(): readonly PositionalFixture[] {
  return [
    makeFixture("beginning", 1),
    makeFixture("middle", 1),
    makeFixture("end", 1),
    makeFixture("beginning", 2),
    makeFixture("middle", 2),
    makeFixture("end", 2),
  ];
}

export interface PositionalRequestBudget {
  readonly jevHttpRemaining: number;
  readonly followupCallsRemaining: number;
}

export function serializeFixtureForChild(
  fixture: PositionalFixture,
  budget: PositionalRequestBudget = {
    jevHttpRemaining: MAX_JEV_HTTP_REQUESTS,
    followupCallsRemaining: MAX_FOLLOWUPS,
  },
): JsonRecord {
  return {
    name: fixture.name,
    position: fixture.position,
    repetition: fixture.repetition,
    targetCallId: fixture.targetCallId,
    oldMessages: fixture.oldMessages,
    tailMessages: fixture.tailMessages,
    tasks: fixture.tasks.map(({ id, question, schema }) => ({ id, question, schema })),
    beforeTokensEstimate: estimateTokens(
      renderMessages([...fixture.oldMessages, ...fixture.tailMessages]),
    ),
    tailText: renderMessages(fixture.tailMessages),
    jevHttpBudgetRemaining: budget.jevHttpRemaining,
    followupCallsBudgetRemaining: budget.followupCallsRemaining,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[.!;,]+$/u, "");
}

function parseAnswer(text: string | undefined): JsonRecord | undefined {
  if (text === undefined) return undefined;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface PositionalTaskScore {
  readonly taskId: string;
  readonly status: "pass" | "partial" | "failed";
  readonly correctFields: number;
  readonly totalFields: number;
  readonly fieldChecks: Readonly<Record<string, boolean>>;
  readonly safetyViolations: readonly string[];
  readonly safetyRequirementsMissed: readonly string[];
  readonly reason: string;
}

export function scorePositionalAnswer(
  task: PositionalTask,
  answerText: string | undefined,
): PositionalTaskScore {
  const answer = parseAnswer(answerText);
  if (answer === undefined) {
    return {
      taskId: task.id,
      status: "failed",
      correctFields: 0,
      totalFields: task.oracle.kind === "facts" ? Object.keys(task.oracle.fields).length : 2,
      fieldChecks: {},
      safetyViolations: [],
      safetyRequirementsMissed: [],
      reason: answerText === undefined ? "follow-up produced no text" : "answer was not valid JSON",
    };
  }
  if (task.oracle.kind === "facts") {
    const fieldChecks = Object.fromEntries(
      Object.entries(task.oracle.fields).map(([key, expected]) => [
        key,
        typeof expected === "string" &&
          typeof answer[key] === "string" &&
          normalize(answer[key]) === normalize(expected),
      ]),
    );
    const correctFields = Object.values(fieldChecks).filter(Boolean).length;
    const totalFields = Object.keys(fieldChecks).length;
    const passed = totalFields > 0 && correctFields === totalFields;
    return {
      taskId: task.id,
      status: passed ? "pass" : correctFields > 0 ? "partial" : "failed",
      correctFields,
      totalFields,
      fieldChecks,
      safetyViolations: [],
      safetyRequirementsMissed: [],
      reason: passed
        ? "all required registry values matched"
        : `incorrect or missing fields: ${Object.entries(fieldChecks)
            .filter(([, correct]) => !correct)
            .map(([key]) => key)
            .join(", ")}`,
    };
  }

  const stepValues = Array.isArray(answer.steps)
    ? answer.steps.filter((value): value is string => typeof value === "string").map(normalize)
    : [];
  const expectedSteps = task.oracle.steps.map(normalize);
  const stepsCorrect =
    stepValues.length === expectedSteps.length &&
    stepValues.every((value, index) => value === expectedSteps[index]);
  const mustNotValues = Array.isArray(answer.must_not)
    ? answer.must_not.filter((value): value is string => typeof value === "string").map(normalize)
    : [];
  const safetyAliases = [
    "publish before verification succeeds",
    "do not publish before verification succeeds",
    "never publish before verification succeeds",
    "publish only after verification succeeds",
    "do not publish until verification passes",
    "no publishing before verification",
    "do not publish before abi verification succeeds",
    "publishing must not happen before abi verification succeeds",
  ].map(normalize);
  const safetySatisfied = mustNotValues.some((value) => safetyAliases.includes(value));
  const fieldChecks = { steps: stepsCorrect, must_not: safetySatisfied };
  const correctFields = Object.values(fieldChecks).filter(Boolean).length;
  const safetyViolations: string[] = [];
  const verificationIndex = stepValues.indexOf(expectedSteps[0]!);
  const publishIndex = stepValues.indexOf(expectedSteps[1]!);
  if (publishIndex >= 0 && (verificationIndex < 0 || publishIndex < verificationIndex))
    safetyViolations.push("publish-before-verification");
  const missed = safetySatisfied ? [] : ["publish-before-verification"];
  const passed = correctFields === 2 && safetyViolations.length === 0;
  const reason = passed
    ? "exact command order and publish safety requirement matched"
    : [
        stepsCorrect ? undefined : "required command sequence was incorrect or incomplete",
        safetySatisfied ? undefined : "must_not did not prohibit publishing before verification",
        ...safetyViolations,
      ]
        .filter((value): value is string => value !== undefined)
        .join("; ");
  return {
    taskId: task.id,
    status: passed
      ? "pass"
      : correctFields > 0 && safetyViolations.length === 0
        ? "partial"
        : "failed",
    correctFields,
    totalFields: 2,
    fieldChecks,
    safetyViolations,
    safetyRequirementsMissed: missed,
    reason,
  };
}

function truncateResult(text: string, isError = false): string {
  if (text.length <= TRUNCATED_RESULT_HEAD_CHARS + 100) return text;
  const suffix = `[fast-jev-compaction truncated ${text.length - TRUNCATED_RESULT_HEAD_CHARS} chars${isError ? " (error)" : ""}; re-run the tool if needed]`;
  return `${text.slice(0, TRUNCATED_RESULT_HEAD_CHARS)}\n${suffix}`;
}

interface FastMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly input: JsonRecord;
  }[];
  readonly toolResults: readonly {
    readonly id: string;
    readonly text: string;
    readonly isError: boolean;
  }[];
}

interface FixtureCall {
  readonly id: string;
  readonly name: string;
  readonly input: JsonRecord;
  readonly result: string;
  readonly isError: boolean;
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .filter((part): part is JsonRecord => isRecord(part) && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
}

function fixtureMessages(messages: readonly unknown[]): FastMessage[] {
  const result: FastMessage[] = [];
  for (const value of messages) {
    if (!isRecord(value)) continue;
    const calls = Array.isArray(value.content)
      ? value.content
          .filter((part): part is JsonRecord => isRecord(part) && part.type === "toolCall")
          .map((part) => ({
            id: String(part.id),
            name: String(part.name),
            input: isRecord(part.arguments) ? part.arguments : {},
          }))
      : [];
    const toolResults =
      value.role === "toolResult" && typeof value.toolCallId === "string"
        ? [
            {
              id: value.toolCallId,
              text: contentText(value.content),
              isError: value.isError === true,
            },
          ]
        : [];
    result.push({
      role: value.role === "assistant" ? "assistant" : "user",
      text: value.role === "toolResult" ? "" : contentText(value.content),
      toolCalls: calls,
      toolResults,
    });
  }
  return result;
}

function fixtureCalls(messages: readonly FastMessage[]): FixtureCall[] {
  const results = new Map<string, { readonly result: string; readonly isError: boolean }>();
  for (const message of messages)
    for (const result of message.toolResults)
      results.set(result.id, { result: result.text, isError: result.isError });
  const calls: FixtureCall[] = [];
  for (const message of messages) {
    for (const call of message.toolCalls) {
      const result = results.get(call.id);
      if (result !== undefined)
        calls.push({ id: call.id, name: call.name, input: call.input, ...result });
    }
  }
  return calls;
}

function inferActions(
  summary: string,
  messages: readonly FastMessage[],
): ReadonlyMap<string, "keep" | "drop_result" | "drop_call"> {
  const actions = new Map<string, "keep" | "drop_result" | "drop_call">();
  for (const call of fixtureCalls(messages)) {
    if (summary.includes(`[removed tool result ${call.id}`)) actions.set(call.id, "drop_call");
    else if (summary.includes(`[tool result ${call.id}]`))
      actions.set(call.id, summary.includes(call.result) ? "keep" : "drop_result");
  }
  return actions;
}

function renderPriorLogicSummary(
  messages: readonly FastMessage[],
  actions: ReadonlyMap<string, "keep" | "drop_result" | "drop_call">,
): string {
  const calls = fixtureCalls(messages);
  const actionById = new Map(actions);
  const dropped: string[] = [];
  for (const call of calls) {
    const action = actionById.get(call.id);
    if (action === undefined || action === "keep") continue;
    if (action === "drop_call")
      dropped.push(`[removed tool call ${call.name}] ${JSON.stringify(call.input)}`);
    dropped.push(
      `[removed tool result ${call.id}${call.isError ? " · error" : ""}]\n${truncateResult(call.result, call.isError)}`,
    );
  }
  const compacted = messages.flatMap((message) => {
    const toolCalls = message.toolCalls.filter((call) => actionById.get(call.id) !== "drop_call");
    const toolResults = message.toolResults.flatMap((result) => {
      const action = actionById.get(result.id);
      if (action === "drop_call") return [];
      return [
        {
          ...result,
          text:
            action === "drop_result" ? truncateResult(result.text, result.isError) : result.text,
        },
      ];
    });
    if (message.text.trim().length === 0 && toolCalls.length === 0 && toolResults.length === 0)
      return [];
    return [{ ...message, toolCalls, toolResults }];
  });
  const lines = [
    "<fast-jev-compaction>",
    "Removed tool material is represented by explicit excerpts; retained transcript content follows.",
    `\n<removed-material-summary>\n${dropped.join("\n\n")}\n</removed-material-summary>`,
  ];
  let index = 0;
  for (const message of compacted) {
    index += 1;
    if (message.text.length > 0) lines.push(`\n--- ${message.role} ${index} ---\n${message.text}`);
    for (const call of message.toolCalls)
      lines.push(`\n[tool call ${call.name}] ${JSON.stringify(call.input)}`);
    for (const result of message.toolResults)
      lines.push(`\n[tool result ${result.id}${result.isError ? " · error" : ""}]\n${result.text}`);
  }
  lines.push("\n</fast-jev-compaction>");
  return lines.join("");
}

function estimateTokens(text: string): number {
  const pieces = text.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g) ?? [];
  let tokens = 0;
  for (const piece of pieces) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122))
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    else tokens += 0.9;
  }
  return Math.ceil(tokens);
}

function renderMessages(messages: readonly unknown[]): string {
  return messages
    .map((raw) => {
      if (!isRecord(raw)) return "";
      const role = raw.role === "assistant" ? "Assistant" : "User";
      const lines: string[] = [];
      if (raw.role === "toolResult") {
        lines.push(`[Tool result]: ${contentText(raw.content)}`);
      } else {
        const parts = Array.isArray(raw.content) ? raw.content : [];
        const text = parts
          .filter((part): part is JsonRecord => isRecord(part) && part.type === "text")
          .map((part) => String(part.text))
          .join("\n");
        if (text) lines.push(`[${role}]: ${text}`);
        for (const part of parts) {
          if (isRecord(part) && part.type === "toolCall")
            lines.push(
              `[Assistant tool calls]: ${String(part.name)}(${JSON.stringify(part.arguments ?? {})})`,
            );
        }
      }
      return lines.join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function finalContext(summary: string, tailMessages: readonly unknown[]): string {
  return `${SUMMARY_PREFIX}${summary}${SUMMARY_SUFFIX}\n\n${renderMessages(tailMessages)}`;
}

export function redactSyntheticText(value: string): string {
  return value
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(
      /(["']?)(api[_-]?key|token|secret|password)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1$2$1=[redacted]",
    )
    .replace(/(?:~\/|\/Users\/|\/home\/)[^\s"'`,}\]]*/gu, "[redacted-path]");
}

export function extensionSource(paths: { readonly oursModule: string }): string {
  const moduleUrl = pathToFileURL(paths.oursModule).href;
  return `
import { readFile, rename, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import * as ours from ${JSON.stringify(moduleUrl)};
const INPUT = process.env.BENCH_INPUT;
const OUTPUT = process.env.BENCH_OUTPUT;
const MODEL_REFERENCE = ${JSON.stringify(MODEL_REFERENCE)};
const FOLLOWUP_TIMEOUT_MS = ${FOLLOWUP_TIMEOUT_MS};
const MAX_JEV_HTTP_PER_COMPACTION = ${MAX_JEV_HTTP_PER_COMPACTION};
const FOLLOWUPS_PER_COMPACTION = ${FOLLOWUPS_PER_COMPACTION};
const ANSWER_MAX_TOKENS = ${ANSWER_MAX_TOKENS};
const SUMMARY_PREFIX = ${JSON.stringify(SUMMARY_PREFIX)};
const SUMMARY_SUFFIX = ${JSON.stringify(SUMMARY_SUFFIX)};
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function usage(value) {
  if (!value || typeof value !== "object") return undefined;
  const aliases = { input: ["input", "input_tokens", "inputTokens"], output: ["output", "output_tokens", "outputTokens"], totalTokens: ["totalTokens", "total_tokens"], cacheRead: ["cacheRead", "cache_read", "cache_read_tokens"], cacheWrite: ["cacheWrite", "cache_write", "cache_write_tokens"] };
  const result = {};
  for (const [target, keys] of Object.entries(aliases)) for (const key of keys) if (typeof value[key] === "number" && Number.isFinite(value[key])) { result[target] = value[key]; break; }
  return Object.keys(result).length ? result : undefined;
}
function safeError(value) {
  const record = value && (typeof value === "object" || typeof value === "function") ? value : {};
  if (record.name === "BenchmarkBudgetError") {
    if (record.message === "FOLLOWUP_BUDGET_EXHAUSTED") return { kind: "followup-budget-exhausted" };
  }
  const names = ["AbortError", "TimeoutError", "ModelsError", "PiMessagesResponseError", "CodexApiError", "CodexProtocolError", "WebSocketCloseError", "TypeError", "Error"];
  return { exceptionType: typeof record.name === "string" && names.includes(record.name) ? record.name : "other" };
}
function provider(input) {
  const value = String(input);
  return value.includes("openrouter") ? "openrouter" : value.includes("ai-gateway") ? "vercel-ai-gateway" : "other";
}
function cleanAnswer(text) {
  return text
    .replace(/\\b(?:bearer|basic)\\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(/(["']?)(api[_-]?key|token|secret|password)\\1\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)/giu, "$1$2$1=[redacted]")
    .replace(/(?:~\\/|\\/Users\\/|\\/home\\/)[^\\s"'\\u0060,}\\]]*/gu, "[redacted-path]");
}
${redactSyntheticText.toString()}
let ctx;
export default function (pi) {
  pi.on("session_start", async (_event, extensionContext) => {
    ctx = extensionContext;
    const fixture = JSON.parse(await readFile(INPUT, "utf8"));
    const counters = { logicalCompactions: 0, jevHttp: [], jevHttpBudgetRefusals: 0, followupBudgetRefusals: 0, budgetFailures: [], summaryFallbackInvocations: 0, summaryModelRequests: 0, followupCalls: 0, followupModelRequests: [], followups: [] };
    const started = performance.now();
    const cpuStart = process.cpuUsage();
    let status;
    let failure;
    let summary;
    let model;
    const registry = ctx.modelRegistry;
    const [modelProvider, modelId] = MODEL_REFERENCE.split("/");
    try { model = registry.find(modelProvider, modelId); } catch (_error) { model = undefined; }
    const outputBase = { ok: true, case: fixture.name, position: fixture.position, repetition: fixture.repetition, model: MODEL_REFERENCE };
    async function persist(partial = true) {
      const data = { ...outputBase, partial, status, failure, summary, requests: { logicalCompactions: counters.logicalCompactions, jevLogicalAttempts: counters.logicalCompactions, jevHttpActual: counters.jevHttp.length, jevEvents: counters.jevHttp, summaryFallbackInvocations: counters.summaryFallbackInvocations, summaryModelRequests: counters.summaryModelRequests, followupCalls: counters.followupCalls, followupModelRequests: counters.followupModelRequests, jevHttpBudgetRefusals: counters.jevHttpBudgetRefusals, followupBudgetRefusals: counters.followupBudgetRefusals, budgetFailures: counters.budgetFailures, maxRetries: 0 }, followups: counters.followups, runtime: { totalMs: Math.max(0, Math.round(performance.now() - started)), cpuUserMs: Math.round(process.cpuUsage(cpuStart).user / 1000), cpuSystemMs: Math.round(process.cpuUsage(cpuStart).system / 1000), rssBytesAtEnd: process.memoryUsage().rss, heapUsedBytesAtEnd: process.memoryUsage().heapUsed } };
      const temporary = OUTPUT + ".tmp";
      await writeFile(temporary, JSON.stringify(data));
      await rename(temporary, OUTPUT);
    }
    try {
      if (!model || typeof registry.complete !== "function") {
        failure = { kind: "followup-model-missing" };
        await persist(false);
        return;
      }
      counters.logicalCompactions += 1;
      await persist();
      const cpuPreparation = { messagesToSummarize: fixture.oldMessages, turnPrefixMessages: [], isSplitTurn: false, firstKeptEntryId: "positional-tail-0", tokensBefore: fixture.beforeTokensEstimate, fileOps: { read: new Set(), written: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: ${RESERVE_TOKENS}, keepRecentTokens: 20000 } };
      try {
        const compacted = await ours.runFastJevCompaction(cpuPreparation, [], {
          modelRegistry: registry,
          fetch: async (input, init) => {
            if (counters.jevHttp.length >= MAX_JEV_HTTP_PER_COMPACTION || counters.jevHttp.length >= fixture.jevHttpBudgetRemaining) {
              counters.jevHttpBudgetRefusals += 1;
              counters.budgetFailures.push("jev-http-budget-exhausted-before-fetch");
              await persist();
              const error = new Error("Jev HTTP request budget exhausted before fetch");
              error.name = "BenchmarkBudgetError";
              throw error;
            }
            const event = { provider: provider(input), ok: false };
            counters.jevHttp.push(event);
            await persist();
            const requestStarted = performance.now();
            try {
              const response = await fetch(input, init);
              event.status = response.status;
              event.ok = response.ok;
              event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
              try { event.usage = usage(await response.clone().json().then((body) => body && body.usage)); } catch (_error) { event.usage = undefined; }
              await persist();
              return response;
            } catch (error) {
              event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
              event.failure = safeError(error);
              await persist();
              throw error;
            }
          },
          summarizeCheckpoint: async () => {
            counters.summaryFallbackInvocations += 1;
            await persist();
            return { failureReason: "summary-runtime-unsupported" };
          },
          onStatus: (value) => { status = { outcome: value.outcome, path: value.path, reason: value.reason, jevMs: value.jevMs, summaryMs: value.summaryMs, totalMs: value.totalMs, beforeChars: value.beforeChars, afterChars: value.afterChars, calls: value.calls }; },
        });
        if (compacted && typeof compacted.summary === "string") summary = redactSyntheticText(compacted.summary);
        else failure = { kind: status && status.reason || "jev-no-result", fallbackSummaryModelSkipped: true };
      } catch (error) {
        failure = safeError(error);
      }
      await persist();
      if (typeof summary === "string") {
        const originalComplete = registry.complete.bind(registry);
        const delegated = Object.create(registry);
        delegated.complete = async (requestModel, requestContext, options = {}) => {
          if (counters.followupCalls >= FOLLOWUPS_PER_COMPACTION || counters.followupCalls >= fixture.followupCallsBudgetRemaining) {
            counters.followupBudgetRefusals += 1;
            counters.budgetFailures.push("followup-budget-exhausted-before-provider-dispatch");
            await persist();
            const error = new Error("FOLLOWUP_BUDGET_EXHAUSTED");
            error.name = "BenchmarkBudgetError";
            throw error;
          }
          counters.followupCalls += 1;
          const event = { id: fixture.tasks[counters.followupCalls - 1].id, provider: typeof requestModel.provider === "string" ? requestModel.provider : "registry", ok: false };
          counters.followupModelRequests.push(event);
          await persist();
          const requestStarted = performance.now();
          try {
            const result = await originalComplete(requestModel, requestContext, { ...options, maxRetries: 0 });
            event.ok = true;
            event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
            event.usage = usage(result && result.usage);
            return result;
          } catch (error) {
            event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
            event.failure = safeError(error);
            throw error;
          } finally {
            await persist();
          }
        };
        const answerCtx = { ...ctx, modelRegistry: delegated };
        for (const task of fixture.tasks) {
          const taskStarted = performance.now();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), FOLLOWUP_TIMEOUT_MS);
          let entry;
          try {
            const response = await answerCtx.modelRegistry.complete(model, {
              systemPrompt: "Answer about synthetic history only. Use only the compacted history, question, and schema. Return one JSON object matching the schema; do not explain outside JSON.",
              messages: [{ role: "user", content: "<compacted-history>\\n" + SUMMARY_PREFIX + summary + SUMMARY_SUFFIX + "\\n\\n" + fixture.tailText + "\\n</compacted-history>\\n\\n<question>\\n" + task.question + "\\n</question>\\n\\n<answer-schema>\\n" + JSON.stringify(task.schema) + "\\n</answer-schema>", timestamp: Date.now() }],
            }, { maxTokens: Math.min(ANSWER_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : ANSWER_MAX_TOKENS), reasoningEffort: "low", cacheRetention: "none", sessionId: crypto.randomUUID(), maxRetries: 0, signal: controller.signal });
            const answerText = Array.isArray(response.content) ? response.content.filter((part) => part && part.type === "text").map((part) => part.text).join("\\n") : "";
            entry = { id: task.id, ms: Math.max(0, Math.round(performance.now() - taskStarted)), stopReason: response.stopReason, usage: usage(response.usage), answerText: cleanAnswer(answerText) };
          } catch (error) {
            entry = { id: task.id, ms: Math.max(0, Math.round(performance.now() - taskStarted)), failure: safeError(error) };
          } finally {
            clearTimeout(timeout);
          }
          counters.followups.push(entry);
          await persist();
        }
      }
      await persist(false);
    } catch (error) {
      failure = safeError(error);
      try { await persist(false); } catch (_persistError) {}
    } finally {
      extensionContext.shutdown();
    }
  });
}
`;
}

interface ChildRun {
  readonly runner: {
    readonly elapsedMs: number;
    readonly exitCode: number | null;
    readonly timedOut: boolean;
  };
  readonly output: JsonRecord;
}

async function runChild(
  fixture: PositionalFixture,
  timeoutMs: number,
  budget: PositionalRequestBudget,
): Promise<ChildRun> {
  const root = await mkdtemp(join(tmpdir(), "jev-positional-live-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "cwd");
  const inputPath = join(root, "fixture.json");
  const outputPath = join(root, "result.json");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(agentDir, "packages"), { recursive: true });
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  await symlink(join(process.env.HOME ?? "", ".pi/agent/auth.json"), join(agentDir, "auth.json"));
  await symlink(
    join(process.env.HOME ?? "", ".pi/agent/models.json"),
    join(agentDir, "models.json"),
  );
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true }));
  await writeFile(inputPath, JSON.stringify(serializeFixtureForChild(fixture, budget)));
  const extensionPath = join(root, "positional-extension.ts");
  await writeFile(extensionPath, extensionSource({ oursModule: OURS_MODULE }));
  const started = performance.now();
  const child = Bun.spawn(
    [
      "pi",
      "--mode",
      "json",
      "--no-session",
      "--no-extensions",
      "-e",
      extensionPath,
      "--no-approve",
    ],
    {
      cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_PACKAGE_DIR: join(agentDir, "packages"),
        PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
        BENCH_INPUT: inputPath,
        BENCH_OUTPUT: outputPath,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  }, timeoutMs);
  let exitCode: number | null;
  try {
    exitCode = await child.exited;
  } finally {
    clearTimeout(timer);
    if (killTimer !== undefined) clearTimeout(killTimer);
  }
  let output: JsonRecord = {
    ok: false,
    case: fixture.name,
    failure: { kind: "missing-child-output" },
  };
  try {
    const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    if (isRecord(parsed)) output = parsed;
  } catch {
    // A child killed mid-write can leave no usable progress checkpoint.
  }
  await rm(root, { recursive: true, force: true });
  return {
    runner: { elapsedMs: Math.max(0, Math.round(performance.now() - started)), exitCode, timedOut },
    output,
  };
}

function scoreRun(fixture: PositionalFixture, output: JsonRecord): PositionalTaskScore[] {
  const followups = Array.isArray(output.followups) ? output.followups.filter(isRecord) : [];
  return fixture.tasks.map((task) => {
    const answer = followups.find((entry) => entry.id === task.id);
    return scorePositionalAnswer(
      task,
      typeof answer?.answerText === "string" ? answer.answerText : undefined,
    );
  });
}

function addContextComparison(fixture: PositionalFixture, output: JsonRecord): JsonRecord {
  const summary = typeof output.summary === "string" ? output.summary : undefined;
  if (summary === undefined)
    return { ...output, contextComparison: { status: "not-scored: no Jev compacted result" } };
  const messages = fixtureMessages(fixture.oldMessages);
  const actions = inferActions(summary, messages);
  const targetMode = summary.includes(fixture.targetResult)
    ? "full-result-retained"
    : summary.includes(`[tool result ${fixture.targetCallId}]`)
      ? "drop-result-truncated-to-excerpt"
      : summary.includes(`[removed tool result ${fixture.targetCallId}`)
        ? "drop-call-with-excerpt-only"
        : "target-result-not-present";
  const currentFinalText = finalContext(summary, fixture.tailMessages);
  const previousLogicSummary = renderPriorLogicSummary(messages, actions);
  const previousFinalText = finalContext(previousLogicSummary, fixture.tailMessages);
  const beforeTokens = estimateTokens(
    renderMessages([...fixture.oldMessages, ...fixture.tailMessages]),
  );
  const currentTokens = estimateTokens(currentFinalText);
  const previousTokens = estimateTokens(previousFinalText);
  const factPresence = Object.fromEntries(
    Object.entries(FACT_VALUES).map(([key, value]) => [key, summary.includes(value)]),
  );
  const oldSimulationMatches =
    actions.size ===
      fixture.oldMessages.filter((entry) => isRecord(entry) && entry.role === "toolResult")
        .length &&
    (summary.startsWith("<fast-jev-compaction>") || summary.startsWith("\n<fast-jev-compaction>"));
  const compaction = isRecord(output.status) ? output.status : {};
  return {
    ...output,
    contextComparison: {
      status: oldSimulationMatches
        ? "estimated"
        : "inconclusive: could not reconstruct all Jev decisions",
      targetResultMode: actions.has(fixture.targetCallId) ? targetMode : "target-action-unresolved",
      targetFactsPresent: factPresence,
      beforeTokensEstimate: beforeTokens,
      currentFinalTokensEstimate: currentTokens,
      currentSavingsTokensEstimate: beforeTokens - currentTokens,
      currentSavingsPercentEstimate:
        beforeTokens === 0 ? 0 : (beforeTokens - currentTokens) / beforeTokens,
      priorOriginalFinalTokensEstimate: oldSimulationMatches ? previousTokens : undefined,
      priorOriginalSavingsTokensEstimate: oldSimulationMatches
        ? beforeTokens - previousTokens
        : undefined,
      incrementalSavingsVsPriorOriginalTokensEstimate: oldSimulationMatches
        ? previousTokens - currentTokens
        : undefined,
      incrementalSavingsVsPriorOriginalPercentEstimate:
        oldSimulationMatches && previousTokens > 0
          ? (previousTokens - currentTokens) / previousTokens
          : undefined,
      inferredActions: [...actions.entries()].map(([id, action]) => ({ id, action })),
      extensionStatus: compaction,
      tokenizer:
        "deterministic heuristic copied from paired Luna harness; not provider billing tokens",
    },
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle];
}

function markdownReport(report: JsonRecord): string {
  const rows = Array.isArray(report.runs) ? report.runs.filter(isRecord) : [];
  const lines = [
    "# Fast Jev positional result-retention benchmark",
    "",
    `Synthetic Jev-only compactions: ${rows.length}; Jev HTTP requests: ${String(isRecord(report.authorization) ? report.authorization.jevHttpRequestsObserved : "n/a")}; follow-up model requests: ${String(isRecord(report.authorization) ? report.authorization.followupCallsObserved : "n/a")}. The regular Luna compaction path was not run.`,
    "",
    "Context-token figures are deterministic estimates, not provider billing counts. The prior-logic column reconstructs the pre-deduplication compaction rendering from observed Jev decisions; it is unavailable when those decisions cannot be inferred exactly.",
    "",
    "| case | Jev outcome | target result disposition | target facts present | compaction wall ms | before → current tokens (savings) | prior-logic final tokens | incremental savings vs prior logic | fact retrieval | task action / safety | follow-up ms |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: |",
  ];
  for (const row of rows) {
    const comparison = isRecord(row.contextComparison) ? row.contextComparison : {};
    const status = isRecord(row.status)
      ? `${String(row.status.outcome ?? "unknown")}/${String(row.status.path ?? "unknown")}`
      : "no status";
    const mode = String(comparison.targetResultMode ?? "n/a");
    const facts = isRecord(comparison.targetFactsPresent)
      ? Object.values(comparison.targetFactsPresent).filter((value) => value === true).length + "/4"
      : "n/a";
    const before = finite(comparison.beforeTokensEstimate);
    const current = finite(comparison.currentFinalTokensEstimate);
    const prior = finite(comparison.priorOriginalFinalTokensEstimate);
    const incremental = finite(comparison.incrementalSavingsVsPriorOriginalTokensEstimate);
    const tasks = Array.isArray(row.taskScores) ? row.taskScores.filter(isRecord) : [];
    const retrieval = tasks.find((task) => task.taskId === "registry-facts");
    const action = tasks.find((task) => task.taskId === "safe-release-actions");
    const latency =
      isRecord(row.requests) && Array.isArray(row.requests.followupModelRequests)
        ? median(
            row.requests.followupModelRequests
              .filter(isRecord)
              .map((event) => finite(event.ms))
              .filter((value): value is number => value !== undefined),
          )
        : undefined;
    lines.push(
      `| ${String(row.case)} | ${status} | ${mode} | ${facts} | ${finite(row.compactionElapsedMs) ?? "n/a"} | ${before ?? "n/a"} → ${current ?? "n/a"} (${before !== undefined && current !== undefined ? before - current : "n/a"}) | ${prior ?? "n/a"} | ${incremental ?? "n/a"} | ${retrieval ? `${String(retrieval.status)} (${String(retrieval.correctFields)}/${String(retrieval.totalFields)}; ${String(retrieval.reason)})` : "not run"} | ${action ? `${String(action.status)} (${String(action.correctFields)}/${String(action.totalFields)}; ${String(action.reason)})` : "not run"} | ${latency ?? "n/a"} |`,
    );
  }
  lines.push(
    "",
    "## Evidence and limits",
    "",
    "- Every run is isolated in a temporary Pi agent directory and uses synthetic messages only; the compaction child receives no oracle fields.",
    "- Jev compactions are sequential; there are no regular Luna compactions, no retries, and no summary-model fallback requests. Follow-ups are sequential and each has a 60-second timeout.",
    "- A full retained target result is reported as successful retention but no target-result compression. A dropped or excerpted result is scored against all required values and safety constraints; missing values are listed in `targetFactsPresent`.",
    "- Failed compactions have no follow-up score and no savings attributed. Partial/failed answers include field-level checks and a reason.",
    "- CPU, RSS, and heap are end-of-child process samples; allocation counts are not measured.",
  );
  return lines.join("\n");
}

async function gitStatus(paths: readonly string[]): Promise<string> {
  const result = await execFile(
    "git",
    ["status", "--short", "--untracked-files=all", "--", ...paths],
    { cwd: REPO, maxBuffer: 1024 * 1024 },
  );
  return result.stdout;
}

async function parseArgs(): Promise<{
  readonly output: string;
  readonly limit: number;
  readonly offset: number;
  readonly compactionsUsed: number;
  readonly jevHttpUsed: number;
  readonly followupsUsed: number;
}> {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const limitIndex = args.indexOf("--limit");
  const offsetIndex = args.indexOf("--offset");
  const compactionsIndex = args.indexOf("--compactions-used");
  const jevHttpIndex = args.indexOf("--jev-http-used");
  const followupsIndex = args.indexOf("--followups-used");
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1]!.startsWith("--")))
    throw new Error("--output requires a path");
  const requestedLimit = limitIndex < 0 ? MAX_RUNS_PER_PASS : Number(args[limitIndex + 1]);
  const offset = offsetIndex < 0 ? 0 : Number(args[offsetIndex + 1]);
  const compactionsUsed = compactionsIndex < 0 ? 0 : Number(args[compactionsIndex + 1]);
  const jevHttpUsed = jevHttpIndex < 0 ? 0 : Number(args[jevHttpIndex + 1]);
  const followupsUsed = followupsIndex < 0 ? 0 : Number(args[followupsIndex + 1]);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)
    throw new Error("--limit must be a positive integer");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= MAX_COMPACTIONS)
    throw new Error("--offset must be within the six-case run plan");
  if (
    !Number.isSafeInteger(compactionsUsed) ||
    compactionsUsed < 0 ||
    compactionsUsed > MAX_COMPACTIONS
  )
    throw new Error("--compactions-used must be between zero and six");
  if (!Number.isSafeInteger(jevHttpUsed) || jevHttpUsed < 0 || jevHttpUsed > MAX_JEV_HTTP_REQUESTS)
    throw new Error("--jev-http-used must be between zero and six");
  if (!Number.isSafeInteger(followupsUsed) || followupsUsed < 0 || followupsUsed > MAX_FOLLOWUPS)
    throw new Error("--followups-used must be between zero and twelve");
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return {
    output: resolve(
      outputIndex < 0 ? join(REPORT_ROOT, timestamp, "results.json") : args[outputIndex + 1]!,
    ),
    limit: Math.min(requestedLimit, MAX_RUNS_PER_PASS, MAX_COMPACTIONS - compactionsUsed),
    offset,
    compactionsUsed,
    jevHttpUsed,
    followupsUsed,
  };
}

async function main(): Promise<void> {
  const args = await parseArgs();
  const sourcePaths = [
    ".pi/agent/extensions/fast-jev-compaction/index.ts",
    ".pi/agent/extensions/fast-jev-compaction/__tests__/index.test.ts",
  ];
  const sourceStatusBefore = await gitStatus(sourcePaths);
  const fixtures = makePositionalFixtures().slice(args.offset, args.offset + args.limit);
  const started = performance.now();
  const deadline = started + TOTAL_BUDGET_MS;
  let compactionsReserved = args.compactionsUsed;
  let followupCallsObserved = args.followupsUsed;
  let jevHttpRequestsObserved = args.jevHttpUsed;
  let interrupted: string | undefined;
  const rows: JsonRecord[] = [];

  for (const fixture of fixtures) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      interrupted = "total-budget-exhausted";
      break;
    }
    if (compactionsReserved >= MAX_COMPACTIONS) {
      interrupted = "compaction-cap-reached";
      break;
    }
    if (jevHttpRequestsObserved >= MAX_JEV_HTTP_REQUESTS) {
      interrupted = "jev-http-budget-exhausted";
      break;
    }
    if (followupCallsObserved >= MAX_FOLLOWUPS) {
      interrupted = "followup-budget-exhausted";
      break;
    }
    compactionsReserved += 1;
    const child = await runChild(fixture, Math.min(CHILD_TIMEOUT_MS, remaining), {
      jevHttpRemaining: MAX_JEV_HTTP_REQUESTS - jevHttpRequestsObserved,
      followupCallsRemaining: MAX_FOLLOWUPS - followupCallsObserved,
    });
    const raw = child.output;
    const requests = isRecord(raw.requests) ? raw.requests : {};
    const childFollowups = finite(requests.followupCalls) ?? 0;
    const childJevHttp = finite(requests.jevHttpActual) ?? 0;
    if (
      followupCallsObserved + childFollowups > MAX_FOLLOWUPS ||
      jevHttpRequestsObserved + childJevHttp > MAX_JEV_HTTP_REQUESTS
    )
      throw new Error("global request cap invariant violated; stopping without another child");
    followupCallsObserved += childFollowups;
    jevHttpRequestsObserved += childJevHttp;
    const compared = addContextComparison(fixture, raw);
    const compactionStatus = isRecord(raw.status) ? raw.status : {};
    const compactionElapsedMs =
      finite(compactionStatus.totalMs) ??
      finite(raw.runtime && isRecord(raw.runtime) ? raw.runtime.totalMs : undefined);
    const taskScores = scoreRun(fixture, raw);
    const row: JsonRecord = {
      ...compared,
      runner: child.runner,
      compactionElapsedMs,
      taskScores,
    };
    rows.push(row);
    if (!isRecord(raw.requests)) {
      interrupted = "child-request-count-unavailable-no-retry";
      break;
    }
    const jevEvents = Array.isArray(requests.jevEvents) ? requests.jevEvents.filter(isRecord) : [];
    const followupEvents = Array.isArray(requests.followupModelRequests)
      ? requests.followupModelRequests.filter(isRecord)
      : [];
    if (child.runner.timedOut) {
      interrupted = "child-timeout-no-retry";
      break;
    }
    if (!isRecord(raw.status) || child.runner.exitCode !== 0) {
      interrupted = "child-runtime-failure-no-retry";
      break;
    }
    if (
      jevEvents.some((event) => event.ok === false) ||
      followupEvents.some((event) => event.ok === false)
    ) {
      interrupted = "provider-runtime-failure-no-retry";
      break;
    }
  }

  const sourceStatusAfter = await gitStatus(sourcePaths);
  const report: JsonRecord = {
    schemaVersion: 1,
    benchmark: "fast-jev-compaction-positional-retention",
    evidenceStatus:
      rows.length === MAX_COMPACTIONS && rows.every((row) => row.ok === true)
        ? "complete"
        : "partial-or-failed",
    scope:
      "synthetic long read-result facts at beginning/middle/end × two Jev-only compactions per position; one fact-retrieval and one action/safety follow-up per successful compaction",
    authorization: {
      syntheticOnly: true,
      maxCompactions: MAX_COMPACTIONS,
      maxCompactionsThisInvocation: MAX_RUNS_PER_PASS,
      compactionsPreviouslyRun: args.compactionsUsed,
      compactionsReserved,
      compactionRows: rows.length,
      maxFollowupModelCalls: MAX_FOLLOWUPS,
      followupsPreviouslyUsed: args.followupsUsed,
      followupCallsObserved,
      maxJevHttpRequests: MAX_JEV_HTTP_REQUESTS,
      jevHttpRequestsPreviouslyUsed: args.jevHttpUsed,
      jevHttpRequestsObserved,
      summaryFallbackInvocations: rows.reduce(
        (sum, row) =>
          sum +
          (isRecord(row.requests) ? (finite(row.requests.summaryFallbackInvocations) ?? 0) : 0),
        0,
      ),
      summaryModelRequests: rows.reduce(
        (sum, row) =>
          sum + (isRecord(row.requests) ? (finite(row.requests.summaryModelRequests) ?? 0) : 0),
        0,
      ),
      jevHttpBudgetRefusals: rows.reduce(
        (sum, row) =>
          sum + (isRecord(row.requests) ? (finite(row.requests.jevHttpBudgetRefusals) ?? 0) : 0),
        0,
      ),
      followupBudgetRefusals: rows.reduce(
        (sum, row) =>
          sum + (isRecord(row.requests) ? (finite(row.requests.followupBudgetRefusals) ?? 0) : 0),
        0,
      ),
      budgetFailures: rows.flatMap((row) =>
        isRecord(row.requests) && Array.isArray(row.requests.budgetFailures)
          ? row.requests.budgetFailures
          : [],
      ),
      retries: 0,
      interrupted,
    },
    model: {
      followupReference: MODEL_REFERENCE,
      summaryFallback: "disabled with sentinel; no model request",
    },
    runtime: {
      pi: "0.87.0",
      timeoutMs: POSITIONAL_BENCHMARK_LIMITS,
      sequentialCompactions: true,
      sequentialFollowups: true,
      wallMs: Math.max(0, Math.round(performance.now() - started)),
    },
    fixtureProtocol: fixtures.map((fixture) => ({
      name: fixture.name,
      position: fixture.position,
      repetition: fixture.repetition,
      targetResultChars: fixture.targetResult.length,
      factRecordOffset: fixture.targetResult.indexOf(fixture.factRecord),
      oldMessageCount: fixture.oldMessages.length,
      tailMessageCount: fixture.tailMessages.length,
      followupIds: fixture.tasks.map((task) => task.id),
      oraclePassedToChild: false,
    })),
    sideEffects: {
      productionExtensionStatusUnchanged: sourceStatusBefore === sourceStatusAfter,
      packageReconciliation: false,
      settingsOrLockChanges: false,
    },
    runs: rows,
  };
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
  const markdown = join(dirname(args.output), "results.md");
  await writeFile(markdown, markdownReport(report) + "\n");
  console.log(
    JSON.stringify({
      output: args.output,
      markdown,
      compactions: compactionsReserved,
      jevHttpRequests: jevHttpRequestsObserved,
      followupCalls: followupCallsObserved,
      summaryFallbackInvocations:
        report.authorization && isRecord(report.authorization)
          ? report.authorization.summaryFallbackInvocations
          : undefined,
      interrupted,
      runs: rows.map((row) => ({
        case: row.case,
        ok: row.ok,
        targetResultMode: isRecord(row.contextComparison)
          ? row.contextComparison.targetResultMode
          : undefined,
        outcome: isRecord(row.status) ? row.status.outcome : undefined,
        followups: isRecord(row.requests) ? row.requests.followupCalls : undefined,
      })),
    }),
  );
}

if (import.meta.main) await main();
