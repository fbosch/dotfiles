#!/usr/bin/env bun
/**
 * Paired live comparison of Fast Jev pruning versus a regular Luna checkpoint,
 * followed by two isolated Luna questions against each successful context.
 */

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify((await import("node:child_process")).execFile);
const REPO = resolve(dirname(import.meta.path), "../../..");
const OURS_MODULE = resolve(REPO, ".pi/agent/extensions/fast-jev-compaction/index.ts");
const MODEL_REFERENCE = "openai-codex/gpt-5.6-luna";
const RESERVE_TOKENS = 4_000;
const ANSWER_MAX_TOKENS = 1_200;
const JEV_TIMEOUT_MS = 2_400;
const LUNA_TIMEOUT_MS = 60_000;
const CHILD_TIMEOUT_MS = 130_000;
const TOTAL_BUDGET_MS = 840_000;
const MAX_COMPACTIONS = 6;
const MAX_FOLLOWUPS = 12;
const MAX_JEV_HTTP_PER_COMPACTION = 2;
const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";
const REPORT_ROOT = join(
  process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? tmpdir(), ".local", "state"),
  "dotfiles",
  "pi-benchmarks",
  "fast-jev-compaction-live",
  "paired-luna",
);

type JsonRecord = Record<string, unknown>;
type Pipeline = "jev" | "regular-luna";
type Scalar = string | boolean;

type SafetyRule = {
  readonly earlier: string;
  readonly later: string;
  readonly violation: string;
};

export type Oracle =
  | { readonly kind: "facts"; readonly fields: Readonly<Record<string, Scalar>> }
  | {
      readonly kind: "plan";
      readonly steps: readonly string[];
      readonly mustNot: readonly string[];
      readonly safetyRules?: readonly SafetyRule[];
      readonly forbiddenSteps?: readonly { readonly step: string; readonly violation: string }[];
    };

export interface BenchmarkTask {
  readonly id: string;
  readonly question: string;
  readonly schema: JsonRecord;
  readonly oracle: Oracle;
}

export interface FixtureCase {
  readonly name:
    | "read-heavy-actionable-fact"
    | "prior-summary-durable-constraints"
    | "protected-error-action-safety";
  readonly description: string;
  readonly previousSummary: string;
  readonly oldMessages: readonly unknown[];
  readonly tailMessages: readonly unknown[];
  readonly tasks: readonly [BenchmarkTask, BenchmarkTask];
}

export const BENCHMARK_TIMEOUTS = {
  jevMs: JEV_TIMEOUT_MS,
  lunaMs: LUNA_TIMEOUT_MS,
  childMs: CHILD_TIMEOUT_MS,
  totalBudgetMs: TOTAL_BUDGET_MS,
} as const;

function message(role: "user" | "assistant", text: string): JsonRecord {
  return { role, content: [{ type: "text", text }] };
}

function toolPair(options: {
  readonly id: string;
  readonly name: string;
  readonly input: JsonRecord;
  readonly result: string;
  readonly isError?: boolean;
}): unknown[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: `Inspecting a synthetic fixture artifact with ${options.name}.` },
        { type: "toolCall", id: options.id, name: options.name, arguments: options.input },
      ],
    },
    {
      role: "toolResult",
      toolCallId: options.id,
      content: [{ type: "text", text: options.result }],
      isError: options.isError === true,
    },
  ];
}

function routineRead(index: number): string {
  return [
    `Synthetic generated directory listing ${index}; these entries are fictional and repeatable.`,
    `The directory contains template-${index}.ts, fixture-${index}.json, and a generated preview.`,
    "Routine metadata: no host files, user data, credentials, or external project content are present.",
    "Generated examples may be recreated from their source templates; retain only migration-specific decisions.",
    "Directory summary: standard imports, test scaffolding, sample keys, and fixture boilerplate.",
    "Routine preview text: " + "sample configuration entry; safe to regenerate. ".repeat(11),
  ].join("\n");
}

function readPair(index: number, path: string, uniqueFact?: string): unknown[] {
  return toolPair({
    id: `read-${index}`,
    name: "read",
    input: { path },
    result: `${uniqueFact ? `${uniqueFact}\n\n` : ""}${routineRead(index)}`,
  });
}

function factSchema(fields: Readonly<Record<string, "string" | "boolean">>): JsonRecord {
  const properties = Object.fromEntries(
    Object.entries(fields).map(([key, type]) => [key, { type }]),
  );
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(fields),
    properties,
  };
}

function planSchema(): JsonRecord {
  return {
    type: "object",
    additionalProperties: false,
    required: ["steps", "must_not"],
    properties: {
      steps: { type: "array", items: { type: "string" } },
      must_not: { type: "array", items: { type: "string" } },
    },
  };
}

function tailMessages(topic: string): unknown[] {
  return [
    message(
      "assistant",
      `The synthetic ${topic} change is staged for review; preserve the review boundary.`,
    ),
    message("user", "Continue from the documented context and state the safe next steps."),
  ];
}

function factsTask(
  id: string,
  question: string,
  fields: Readonly<Record<string, Scalar>>,
): BenchmarkTask {
  return {
    id,
    question,
    schema: factSchema(
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeof value === "boolean" ? "boolean" : "string",
        ]),
      ),
    ),
    oracle: { kind: "facts", fields },
  };
}

function planTask(options: {
  readonly id: string;
  readonly question: string;
  readonly steps: readonly string[];
  readonly mustNot: readonly string[];
  readonly safetyRules?: readonly SafetyRule[];
  readonly forbiddenSteps?: readonly { readonly step: string; readonly violation: string }[];
}): BenchmarkTask {
  return {
    id: options.id,
    question: options.question,
    schema: planSchema(),
    oracle: {
      kind: "plan",
      steps: options.steps,
      mustNot: options.mustNot,
      ...(options.safetyRules === undefined ? {} : { safetyRules: options.safetyRules }),
      ...(options.forbiddenSteps === undefined ? {} : { forbiddenSteps: options.forbiddenSteps }),
    },
  };
}

function makeReadHeavyFixture(): FixtureCase {
  const oldMessages: unknown[] = [
    message(
      "user",
      "Integrate the older Atlas job records. Inspect the generated modules and preserve exact compatibility details and the documented validation order.",
    ),
  ];
  const paths = [
    "packages/atlas/src/generated/types.ts",
    "packages/atlas/src/generated/index.ts",
    "packages/atlas/test/fixtures/basic.json",
    "packages/atlas/src/jobs/queue.ts",
    "packages/atlas/src/legacy/decoder.ts",
    "packages/atlas/src/jobs/serializer.ts",
    "packages/atlas/src/generated/schema.ts",
    "packages/atlas/test/fixtures/retry.json",
  ];
  for (let index = 0; index < paths.length; index += 1) {
    const fact =
      index === 4
        ? "Legacy format 2.3; decoder packages/atlas/src/legacy/decoder.ts; gate with --allow-legacy-jobs; dependency @atlas/schema-reader@^3.4.1. Run atlas jobs validate --strict before atlas jobs generate."
        : undefined;
    oldMessages.push(...readPair(index, paths[index]!, fact));
  }
  return {
    name: "read-heavy-actionable-fact",
    description:
      "Eight successful read results; one contains the legacy decoder tuple and validation prerequisite amid recreatable generated listings.",
    previousSummary: "",
    oldMessages,
    tailMessages: tailMessages("Atlas"),
    tasks: [
      factsTask(
        "atlas-legacy-tuple",
        "From the compacted history, return the exact decoder path, legacy schema version, enable flag, and required dependency with its version range.",
        {
          path: "packages/atlas/src/legacy/decoder.ts",
          schema_version: "2.3",
          enable_flag: "--allow-legacy-jobs",
          dependency: "@atlas/schema-reader@^3.4.1",
        },
      ),
      planTask({
        id: "atlas-safe-order",
        question:
          "What documented commands must run, and in what order, before accepting regenerated Atlas outputs? Explicitly state anything that must not happen before validation.",
        steps: ["validate_legacy_records", "generate_outputs"],
        mustNot: ["no_generation_before_validation"],
        safetyRules: [
          {
            earlier: "validate_legacy_records",
            later: "generate_outputs",
            violation: "generation-before-validation",
          },
        ],
      }),
    ],
  };
}

function makePriorSummaryFixture(): FixtureCase {
  const previousSummary = [
    "Durable Harbor rollout decision from the prior checkpoint:",
    "The artifact format is 5.1 and the feature remains disabled by default.",
    "Write output to ./state/harbor/manifest.json; keep the public input option named --source.",
    "Run harbor check --compat first. Only if it passes may the manifest be written.",
  ].join("\n");
  const oldMessages: unknown[] = [
    message("user", "Continue the Harbor rollout using the prior durable compatibility decision."),
  ];
  const paths = [
    "packages/harbor/src/config.ts",
    "packages/harbor/src/manifest.ts",
    "packages/harbor/src/generated/defaults.ts",
    "packages/harbor/test/fixture-a.json",
    "packages/harbor/src/compat/check.ts",
    "packages/harbor/src/manifest-writer.ts",
    "packages/harbor/test/fixture-b.json",
    "packages/harbor/src/generated/types.ts",
  ];
  for (let index = 0; index < paths.length; index += 1)
    oldMessages.push(...readPair(index, paths[index]!));
  return {
    name: "prior-summary-durable-constraints",
    description:
      "Eight successful read candidates exercise Jev while durable format/default/path/option/order constraints arrive only in the previous summary.",
    previousSummary,
    oldMessages,
    tailMessages: tailMessages("Harbor"),
    tasks: [
      factsTask(
        "harbor-prior-tuple",
        "Return the prior decision's artifact format, default enabled state, output path, and unchanged public input option.",
        {
          format_version: "5.1",
          default_enabled: false,
          artifact_path: "./state/harbor/manifest.json",
          public_option: "--source",
        },
      ),
      planTask({
        id: "harbor-safe-order",
        question:
          "State the required check/write order and the public interface constraint that must not be violated.",
        steps: ["run_compatibility_check", "write_manifest"],
        mustNot: ["no_public_option_rename"],
        safetyRules: [
          {
            earlier: "run_compatibility_check",
            later: "write_manifest",
            violation: "manifest-write-before-compat-check",
          },
        ],
      }),
    ],
  };
}

function makeProtectedFixture(): FixtureCase {
  const oldMessages: unknown[] = [
    message(
      "user",
      "Repair the synthetic Coral runtime after verification failed. Keep the completed staging action and its failure in context; do not repeat completed actions.",
    ),
  ];
  const paths = [
    "services/coral/generated/options.ts",
    "services/coral/runtime.yaml",
    "services/coral/src/hooks.ts",
    "services/coral/test/runtime-a.json",
    "services/coral/src/generated/manifest.ts",
    "services/coral/test/runtime-b.json",
    "services/coral/src/hooks/compat.ts",
  ];
  for (let index = 0; index < paths.length; index += 1) {
    const fact =
      index === 1
        ? "The target is services/coral/runtime.yaml. It runs Coral 8.2.4, requires coral-hook@~2.7.0, and enables strict hook checks with --strict-hooks."
        : undefined;
    oldMessages.push(...readPair(index, paths[index]!, fact));
  }
  oldMessages.push(
    ...toolPair({
      id: "failed-coral-verify",
      name: "bash",
      input: { command: "coral verify --strict-hooks", cwd: "services/coral" },
      result:
        "Synthetic validation failed: the strict hook verifier reports a missing runtime module. Inspect this failure and confirm the declared module version before changing the configuration. The command did not apply changes.\n" +
        "Diagnostic detail: " +
        "fictional verifier output; no external files or credentials. ".repeat(12),
      isError: true,
    }),
    ...toolPair({
      id: "completed-coral-edit",
      name: "edit",
      input: { path: "services/coral/runtime.yaml", operation: "stage-review-diff" },
      result:
        "A synthetic review diff was staged successfully for services/coral/runtime.yaml. Preserve this completed staging operation; do not repeat it or discard the review boundary.\n" +
        "Staging detail: " +
        "fictional action record, already completed. ".repeat(12),
    }),
  );
  return {
    name: "protected-error-action-safety",
    description:
      "Seven successful read candidates plus a protected failed bash check and completed edit action, all before the retained tail.",
    previousSummary: "",
    oldMessages,
    tailMessages: tailMessages("Coral"),
    tasks: [
      factsTask(
        "coral-runtime-tuple",
        "Return the exact target path, runtime version, required module range, and strict-check flag from the compacted history.",
        {
          target_path: "services/coral/runtime.yaml",
          runtime_version: "8.2.4",
          module_requirement: "coral-hook@~2.7.0",
          feature_flag: "--strict-hooks",
        },
      ),
      planTask({
        id: "coral-safe-recovery",
        question:
          "Give the safe next-action sequence after the failed strict verification, accounting for the already completed staging action. State explicitly what must not be replayed.",
        steps: [
          "inspect_failed_check",
          "confirm_dependency",
          "apply_needed_fix",
          "run_verification",
          "review_diff",
        ],
        mustNot: ["no_replay_completed_edit"],
        safetyRules: [
          {
            earlier: "inspect_failed_check",
            later: "apply_needed_fix",
            violation: "change-before-inspecting-failure",
          },
          {
            earlier: "run_verification",
            later: "review_diff",
            violation: "diff-review-before-verification",
          },
        ],
        forbiddenSteps: [{ step: "replay_completed_edit", violation: "replayed-completed-edit" }],
      }),
    ],
  };
}

export function makeFixtures(): readonly FixtureCase[] {
  return [makeReadHeavyFixture(), makePriorSummaryFixture(), makeProtectedFixture()];
}

export function serializeFixtureForChild(fixture: FixtureCase): JsonRecord {
  return {
    name: fixture.name,
    description: fixture.description,
    previousSummary: fixture.previousSummary,
    oldMessages: fixture.oldMessages,
    tailMessages: fixture.tailMessages,
    tasks: fixture.tasks.map(({ id, question, schema }) => ({ id, question, schema })),
  };
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

function pathFile(value: string): string {
  return pathToFileURL(value).href;
}

function extensionSource(paths: { oursModule: string }): string {
  const q = (value: string) => JSON.stringify(pathFile(value));
  return `
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import * as ours from ${q(paths.oursModule)};
const INPUT = process.env.BENCH_INPUT;
const OUTPUT = process.env.BENCH_OUTPUT;
const PIPELINE = process.env.BENCH_PIPELINE;
const MODEL_REFERENCE = ${JSON.stringify(MODEL_REFERENCE)};
const RESERVE_TOKENS = ${RESERVE_TOKENS};
const ANSWER_MAX_TOKENS = ${ANSWER_MAX_TOKENS};
const JEV_TIMEOUT_MS = ${JEV_TIMEOUT_MS};
const LUNA_TIMEOUT_MS = ${LUNA_TIMEOUT_MS};
const MAX_JEV_HTTP_PER_COMPACTION = ${MAX_JEV_HTTP_PER_COMPACTION};
const SUMMARY_PREFIX = ${JSON.stringify(SUMMARY_PREFIX)};
const SUMMARY_SUFFIX = ${JSON.stringify(SUMMARY_SUFFIX)};
const TOKEN_PIECES = /[A-Za-z]+|\\d+|[^\\sA-Za-z\\d]/g;
function estimateTokens(text) {
  const pieces = text.match(TOKEN_PIECES) || [];
  let tokens = 0;
  for (const piece of pieces) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) tokens += 1 + Math.floor((piece.length - 1) / 6);
    else tokens += 0.9;
  }
  return Math.ceil(tokens);
}
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && typeof part.text === "string").map((part) => part.text).join("\\n");
}
function toMessage(raw) {
  if (raw?.role === "toolResult") return { role: "user", text: "", toolCalls: [], toolResults: [{ toolUseId: raw.toolCallId, text: contentText(raw.content), isError: raw.isError === true }] };
  const parts = Array.isArray(raw?.content) ? raw.content : [];
  const calls = parts.filter((part) => part?.type === "toolCall").map((part) => ({ toolUseId: part.id, name: part.name, input: part.arguments ?? {} }));
  const text = parts.filter((part) => part?.type === "text").map((part) => part.text).join("\\n");
  return { role: raw?.role === "assistant" ? "assistant" : "user", text, toolCalls: calls, toolResults: [] };
}
function renderMessages(messages) {
  return messages.map((raw) => {
    const message = toMessage(raw);
    const lines = [];
    const role = message.role === "assistant" ? "Assistant" : "User";
    if (message.text) lines.push("[" + role + "]: " + message.text);
    for (const call of message.toolCalls) lines.push("[Assistant tool calls]: " + call.name + "(" + JSON.stringify(call.input) + ")");
    for (const result of message.toolResults) lines.push("[Tool result" + (result.isError ? " · error" : "") + "]: " + result.text);
    return lines.join("\\n\\n");
  }).filter(Boolean).join("\\n\\n");
}
function usage(value) {
  if (!value || typeof value !== "object") return undefined;
  const aliases = { input: ["input", "input_tokens", "inputTokens"], output: ["output", "output_tokens", "outputTokens"], totalTokens: ["totalTokens", "total_tokens"], cacheRead: ["cacheRead", "cache_read", "cache_read_tokens"], cacheWrite: ["cacheWrite", "cache_write", "cache_write_tokens"] };
  const result = {};
  for (const [target, keys] of Object.entries(aliases)) for (const key of keys) if (typeof value[key] === "number" && Number.isFinite(value[key])) { result[target] = value[key]; break; }
  return Object.keys(result).length ? result : undefined;
}
function safeError(value) {
  const record = value && (typeof value === "object" || typeof value === "function") ? value : {};
  const knownNames = ["AbortError", "TimeoutError", "ModelsError", "PiMessagesResponseError", "CodexApiError", "CodexProtocolError", "WebSocketCloseError", "TypeError", "Error"];
  const result = {};
  if (typeof record.name === "string") result.exceptionType = knownNames.includes(record.name) ? record.name : "other";
  for (const key of ["status", "statusCode", "httpStatus"]) if (Number.isInteger(record[key])) { result.httpStatus = record[key]; break; }
  if (typeof record.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(record.code)) result.providerCode = record.code;
  return Object.keys(result).length ? result : { exceptionType: "other" };
}
${redactSyntheticText.toString()}
function modelProvider(model) {
  const provider = typeof model?.provider === "string" ? model.provider : typeof model?.providerId === "string" ? model.providerId : "registry";
  return provider.toLowerCase().includes("gateway") ? "vercel-ai-gateway" : provider;
}
function contextEstimate(value) {
  try {
    const json = JSON.stringify(value);
    const text = JSON.stringify(value.messages ?? []);
    return { bodyBytes: new TextEncoder().encode(json).byteLength, inputTokensEstimate: estimateTokens(text) };
  } catch {
    return {};
  }
}
function wrap(summary) { return SUMMARY_PREFIX + summary + SUMMARY_SUFFIX; }
function occurrenceCount(text, part) {
  if (!part) return 0;
  let count = 0;
  let from = 0;
  while (true) { const index = text.indexOf(part, from); if (index < 0) return count; count += 1; from = index + part.length; }
}
async function run() {
  if (!INPUT || !OUTPUT || !PIPELINE) throw new Error("missing benchmark environment");
  const fixture = JSON.parse(await readFile(INPUT, "utf8"));
  const counters = { logicalCompactions: 0, jevHttp: [], summaryFunctions: 0, summaryRequests: [], followupCalls: 0, followupRequests: [] };
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  const registry = ctx.modelRegistry;
  const [provider, modelId] = MODEL_REFERENCE.split("/");
  const lunaModel = registry.find(provider, modelId);
  if (!lunaModel || typeof registry.complete !== "function") {
    await writeFile(OUTPUT, JSON.stringify({ ok: false, error: { kind: "summary-model-missing" }, case: fixture.name, pipeline: PIPELINE }));
    return;
  }
  const originalComplete = registry.complete.bind(registry);
  function trackedContext(phase, id, controller) {
    const delegated = Object.create(registry);
    delegated.complete = async (requestModel, requestContext, options = {}) => {
      const event = { phase, id, provider: modelProvider(requestModel), ok: false, ...contextEstimate(requestContext) };
      const requests = phase === "summary" ? counters.summaryRequests : counters.followupRequests;
      if (phase === "summary" && requests.length >= 1) throw new Error("summary request budget exceeded");
      if (phase === "followup" && counters.followupCalls >= 2) throw new Error("follow-up budget exceeded");
      if (phase === "followup") counters.followupCalls += 1;
      requests.push(event);
      const requestStarted = performance.now();
      try {
        const result = await originalComplete(requestModel, requestContext, { ...options, maxRetries: 0, signal: controller.signal });
        event.ok = true;
        event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
        event.usage = usage(result?.usage);
        return result;
      } catch (error) {
        event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
        event.failure = safeError(error);
        throw error;
      }
    };
    return { ...ctx, modelRegistry: delegated };
  }
  async function runSummary(messages, previousSummary, customInstructions, signal) {
    counters.summaryFunctions += 1;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), LUNA_TIMEOUT_MS);
    try {
      return await ours.summarizePreparedWithModel(
        trackedContext("summary", "compaction-summary", controller),
        MODEL_REFERENCE,
        messages,
        previousSummary,
        RESERVE_TOKENS,
        customInstructions,
        controller.signal,
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  const oldMessages = fixture.oldMessages;
  const tailMessages = fixture.tailMessages;
  const previousSummary = fixture.previousSummary || "";
  const tailText = renderMessages(tailMessages);
  const baselineText = (previousSummary ? wrap(previousSummary) + "\\n\\n" : "") + renderMessages([...oldMessages, ...tailMessages]);
  const beforeTokens = estimateTokens(baselineText);
  const preparation = {
    messagesToSummarize: oldMessages,
    turnPrefixMessages: [],
    isSplitTurn: false,
    firstKeptEntryId: "paired-luna-tail-0",
    tokensBefore: beforeTokens,
    previousSummary: previousSummary || undefined,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: RESERVE_TOKENS, keepRecentTokens: 20_000 },
  };
  let outputSummary;
  let status;
  let failure;
  let compactionMs = 0;
  const compactionStarted = performance.now();
  if (counters.logicalCompactions >= 1) throw new Error("compaction budget exceeded");
  counters.logicalCompactions += 1;
  if (PIPELINE === "jev") {
    try {
      const result = await ours.runFastJevCompaction(preparation, [], {
        modelRegistry: registry,
        fetch: async (input, init) => {
          if (counters.jevHttp.length >= MAX_JEV_HTTP_PER_COMPACTION) throw new Error("Jev gateway request budget exceeded");
          const event = { provider: String(input).includes("openrouter") ? "openrouter" : String(input).includes("ai-gateway") ? "vercel-ai-gateway" : "other" };
          counters.jevHttp.push(event);
          const requestStarted = performance.now();
          try {
            const response = await fetch(input, init);
            event.status = response.status;
            event.ok = response.ok;
            event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
            try { event.usage = usage(await response.clone().json().then((body) => body?.usage)); } catch (_error) { event.usage = undefined; }
            return response;
          } catch (error) {
            event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
            event.failure = safeError(error);
            throw error;
          }
        },
        summarizeCheckpoint: runSummary,
        onStatus: (value) => { status = { outcome: value.outcome, path: value.path, reason: value.reason, jevMs: value.jevMs, summaryMs: value.summaryMs, totalMs: value.totalMs, calls: value.calls }; },
      });
      if (result) outputSummary = result.summary;
      else failure = { kind: status?.reason ?? "jev-no-result" };
    } catch (error) {
      failure = safeError(error);
    }
  } else {
    try {
      const result = await runSummary(oldMessages, previousSummary || undefined, undefined, undefined);
      if (result && typeof result.text === "string" && result.text.trim()) {
        outputSummary = result.text;
        status = { outcome: "summarized", path: "regular-luna", reason: undefined };
      } else failure = { kind: result?.failureReason ?? "summary-empty-output", diagnostics: result?.diagnostics };
    } catch (error) {
      failure = safeError(error);
    }
  }
  compactionMs = Math.max(0, Math.round(performance.now() - compactionStarted));
  const compactionSucceeded = typeof outputSummary === "string" && outputSummary.trim().length > 0;
  const finalContext = compactionSucceeded ? wrap(outputSummary) + "\\n\\n" + tailText : undefined;
  const followups = [];
  if (compactionSucceeded) {
    const results = await Promise.all(fixture.tasks.map(async (task) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LUNA_TIMEOUT_MS);
      const taskStarted = performance.now();
      try {
        const answerCtx = trackedContext("followup", task.id, controller);
        const maxTokens = Math.min(ANSWER_MAX_TOKENS, lunaModel.maxTokens > 0 ? lunaModel.maxTokens : ANSWER_MAX_TOKENS);
        const response = await answerCtx.modelRegistry.complete(lunaModel, {
          systemPrompt: "Answer a follow-up about synthetic history only. Use only the compacted history and question. Return one JSON object matching the supplied schema; do not explain outside the JSON.",
          messages: [{ role: "user", content: "<compacted-history>\\n" + finalContext + "\\n</compacted-history>\\n\\n<question>\\n" + task.question + "\\n</question>\\n\\n<answer-schema>\\n" + JSON.stringify(task.schema) + "\\n</answer-schema>", timestamp: Date.now() }],
        }, {
          maxTokens,
          reasoningEffort: "low",
          cacheRetention: "none",
          sessionId: crypto.randomUUID(),
          maxRetries: 0,
          signal: controller.signal,
        });
        if (response.stopReason === "error" || response.stopReason === "aborted") return { id: task.id, ms: Math.max(0, Math.round(performance.now() - taskStarted)), stopReason: response.stopReason, usage: usage(response.usage), failure: { kind: "model-response-error" } };
        const answerText = Array.isArray(response.content) ? response.content.filter((part) => part?.type === "text").map((part) => part.text).join("\\n") : "";
        return {
          id: task.id,
          ms: Math.max(0, Math.round(performance.now() - taskStarted)),
          stopReason: response.stopReason,
          usage: usage(response.usage),
          answerText,
        };
      } catch (error) {
        return { id: task.id, ms: Math.max(0, Math.round(performance.now() - taskStarted)), failure: safeError(error) };
      } finally {
        clearTimeout(timeout);
      }
    }));
    followups.push(...results);
  }
  const totalMs = Math.max(0, Math.round(performance.now() - started));
  const cpu = process.cpuUsage(cpuStart);
  const memory = process.memoryUsage();
  const finalTokens = compactionSucceeded ? estimateTokens(finalContext) : beforeTokens;
  const result = {
    ok: true,
    case: fixture.name,
    pipeline: PIPELINE,
    model: MODEL_REFERENCE,
    input: {
      oldMessageCount: oldMessages.length,
      tailMessageCount: tailMessages.length,
      previousSummaryIncluded: Boolean(previousSummary),
      tailAppendedExactlyOnce: compactionSucceeded && occurrenceCount(finalContext, tailText) === 1,
      fullContextParts: "same old messages + prior summary once for both compaction functions; retained tail appended once after compaction",
      followupInput: "compacted final context + one task question + answer schema only",
    },
    status,
    failure,
    compaction: {
      succeeded: compactionSucceeded,
      trueJevPruning: PIPELINE === "jev" && status?.outcome === "pruned" && status?.path === "prune",
      summary: compactionSucceeded ? redactSyntheticText(outputSummary) : undefined,
      elapsedMs: compactionMs,
      beforeTokensEstimate: beforeTokens,
      finalTokensEstimate: finalTokens,
      savingsTokensEstimate: compactionSucceeded ? beforeTokens - finalTokens : 0,
      savingsPercentEstimate: compactionSucceeded && beforeTokens > 0 ? (beforeTokens - finalTokens) / beforeTokens : 0,
      retainedTailTokensEstimate: estimateTokens(tailText),
    },
    requests: {
      logicalCompactions: counters.logicalCompactions,
      jevLogicalAttempts: PIPELINE === "jev" ? 1 : 0,
      jevHttpActual: counters.jevHttp.length,
      jevEvents: counters.jevHttp,
      summaryFunctionCalls: counters.summaryFunctions,
      summaryModelRequests: counters.summaryRequests,
      followupCalls: counters.followupCalls,
      followupModelRequests: counters.followupRequests,
      maxRetries: 0,
      gatewayFailoverActualRequests: counters.jevHttp.filter((event) => event.provider === "openrouter").length,
    },
    followups: compactionSucceeded
      ? followups.map((entry) => ({ ...entry, answerText: typeof entry.answerText === "string" ? redactSyntheticText(entry.answerText) : undefined }))
      : [],
    followupsSkipped: compactionSucceeded ? 0 : 2,
    runtime: {
      totalMs,
      cpuUserMs: Math.round(cpu.user / 1_000),
      cpuSystemMs: Math.round(cpu.system / 1_000),
      rssBytesAtEnd: memory.rss,
      heapUsedBytesAtEnd: memory.heapUsed,
      allocationsMeasured: false,
    },
  };
  await writeFile(OUTPUT, JSON.stringify(result));
}
let ctx;
export default function (pi) {
  pi.on("session_start", async (_event, extensionContext) => {
    ctx = extensionContext;
    try { await run(); }
    catch (error) { await writeFile(OUTPUT, JSON.stringify({ ok: false, error: safeError(error), pipeline: PIPELINE })); }
    finally { extensionContext.shutdown(); }
  });
}
`;
}

interface ChildResult {
  readonly elapsedMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

async function gitStatus(): Promise<string> {
  const result = await execFile(
    "git",
    ["status", "--short", "--untracked-files=all", "--", ".pi/agent"],
    {
      cwd: REPO,
      maxBuffer: 1024 * 1024,
    },
  );
  return result.stdout;
}

async function runChild(
  pipeline: Pipeline,
  fixturePath: string,
  outputPath: string,
  timeoutMs: number,
): Promise<ChildResult> {
  const root = await mkdtemp(join(tmpdir(), "paired-luna-live-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "cwd");
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
  const extensionPath = join(root, "paired-luna-extension.ts");
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
        BENCH_INPUT: fixturePath,
        BENCH_OUTPUT: outputPath,
        BENCH_PIPELINE: pipeline,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    },
    Math.max(1, timeoutMs),
  );
  let exitCode: number | null;
  try {
    exitCode = await child.exited;
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    await rm(root, { recursive: true, force: true });
  }
  return { elapsedMs: Math.max(0, Math.round(performance.now() - started)), exitCode, timedOut };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOutput(
  path: string,
  runner: ChildResult,
  pipeline: Pipeline,
  fixture: FixtureCase,
): Promise<JsonRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isRecord(parsed)) return { ...parsed, runner, pipeline, case: fixture.name };
  } catch (_error) {
    // Missing child output is retained as a sanitized runner failure only.
  }
  return {
    ok: false,
    runner,
    pipeline,
    case: fixture.name,
    error: { exceptionType: "missing-child-output" },
  };
}

const ACTION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  validate_legacy_records: [
    "validate_legacy_records",
    "validate legacy records",
    "atlas jobs validate --strict",
    "run atlas jobs validate --strict",
  ],
  generate_outputs: [
    "generate_outputs",
    "generate outputs",
    "atlas jobs generate",
    "generate atlas outputs",
  ],
  run_compatibility_check: [
    "run_compatibility_check",
    "run compatibility check",
    "harbor check --compat",
    "check compatibility",
  ],
  write_manifest: ["write_manifest", "write manifest", "write the manifest", "update the manifest"],
  inspect_failed_check: [
    "inspect_failed_check",
    "inspect failed check",
    "inspect failure",
    "inspect the failed verification",
    "inspect verifier output",
    "review the failure",
  ],
  confirm_dependency: [
    "confirm_dependency",
    "confirm dependency",
    "check module version",
    "verify dependency version",
  ],
  apply_needed_fix: [
    "apply_needed_fix",
    "apply needed fix",
    "correct the configuration",
    "adjust the dependency",
    "apply fix",
  ],
  run_verification: [
    "run_verification",
    "run verification",
    "run the verifier",
    "coral verify --strict-hooks",
    "verify configuration",
  ],
  review_diff: ["review_diff", "review diff", "inspect diff", "verify diff"],
  replay_completed_edit: [
    "replay_completed_edit",
    "repeat completed edit",
    "replay the completed edit",
    "repeat staging action",
    "rerun completed edit",
  ],
};

const CONSTRAINT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  no_generation_before_validation: [
    "no_generation_before_validation",
    "do not generate before validation",
    "no generation until validation passes",
    "validate before generating",
  ],
  no_public_option_rename: [
    "no_public_option_rename",
    "do not rename the public option",
    "keep --source unchanged",
    "preserve --source",
  ],
  no_replay_completed_edit: [
    "no_replay_completed_edit",
    "do not repeat the completed edit",
    "do not replay the staging action",
    "preserve the completed edit",
  ],
};

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[`"']|[`"']$/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/[.!;,]+$/u, "");
}

function canonical(
  value: unknown,
  aliases: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = normalized(value);
  return Object.entries(aliases).find(([, values]) =>
    values.some((candidate) => normalized(candidate) === key),
  )?.[0];
}

function parseAnswer(text: string): JsonRecord | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(parsed) ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

export interface TaskScore {
  readonly taskId: string;
  readonly kind: "facts" | "plan";
  readonly passed: boolean;
  readonly correctFields: number;
  readonly totalFields: number;
  readonly fieldChecks: Readonly<Record<string, boolean>>;
  readonly safetyViolations: readonly string[];
  readonly safetyRequirementsMissed: readonly string[];
  readonly parsed: JsonRecord | null;
}

export function scoreAnswer(task: BenchmarkTask, answerText: string | undefined): TaskScore {
  const answer = answerText === undefined ? undefined : parseAnswer(answerText);
  const oracle = task.oracle;
  if (oracle.kind === "facts") {
    const fieldChecks: Record<string, boolean> = {};
    const checks = Object.entries(oracle.fields).map(([key, expected]) => {
      const actual = answer?.[key];
      const correct =
        typeof expected === "boolean"
          ? actual === expected
          : typeof actual === "string" &&
            normalized(actual).replace(/\s+/gu, "") === normalized(expected).replace(/\s+/gu, "");
      fieldChecks[key] = correct;
      return correct;
    });
    const correctFields = checks.filter(Boolean).length;
    return {
      taskId: task.id,
      kind: "facts",
      passed: checks.length > 0 && correctFields === checks.length,
      correctFields,
      totalFields: checks.length,
      fieldChecks,
      safetyViolations: [],
      safetyRequirementsMissed: [],
      parsed: answer ?? null,
    };
  }

  const actualSteps = Array.isArray(answer?.steps)
    ? answer.steps.map((value) => canonical(value, ACTION_ALIASES))
    : [];
  const expectedSteps = oracle.steps;
  const stepChecks = expectedSteps.map((step, index) => actualSteps[index] === step);
  const actualConstraints = Array.isArray(answer?.must_not)
    ? answer.must_not.map((value) => canonical(value, CONSTRAINT_ALIASES))
    : [];
  const constraintChecks = oracle.mustNot.map((constraint) =>
    actualConstraints.includes(constraint),
  );
  const violations: string[] = [];
  for (const rule of oracle.safetyRules ?? []) {
    const earlier = actualSteps.indexOf(rule.earlier);
    const later = actualSteps.indexOf(rule.later);
    if (later >= 0 && (earlier < 0 || earlier > later)) violations.push(rule.violation);
  }
  for (const forbidden of oracle.forbiddenSteps ?? [])
    if (actualSteps.includes(forbidden.step)) violations.push(forbidden.violation);
  const missed = oracle.mustNot.filter((_, index) => !constraintChecks[index]);
  const fieldChecks = Object.fromEntries([
    ["steps", stepChecks.length === expectedSteps.length && stepChecks.every(Boolean)],
    [
      "must_not",
      constraintChecks.length === oracle.mustNot.length && constraintChecks.every(Boolean),
    ],
  ]);
  const correctFields = Object.values(fieldChecks).filter(Boolean).length;
  const totalFields = Object.keys(fieldChecks).length;
  return {
    taskId: task.id,
    kind: "plan",
    passed: correctFields === totalFields && violations.length === 0,
    correctFields,
    totalFields,
    fieldChecks,
    safetyViolations: violations,
    safetyRequirementsMissed: missed,
    parsed: answer ?? null,
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

export function pipelineOrderForCase(index: number): readonly Pipeline[] {
  return index % 2 === 0 ? ["jev", "regular-luna"] : ["regular-luna", "jev"];
}

function delta(value: number | undefined, baseline: number | undefined): string {
  if (value === undefined || baseline === undefined) return "n/a";
  const percent = baseline === 0 ? "n/a" : `${(((value - baseline) / baseline) * 100).toFixed(1)}%`;
  return `${value - baseline >= 0 ? "+" : ""}${(value - baseline).toFixed(1)} (${percent})`;
}

export function resultsMarkdown(report: JsonRecord, fixtures: readonly FixtureCase[]): string {
  const rows = Array.isArray(report.runs) ? report.runs.filter(isRecord) : [];
  const lines = [
    "# Paired Fast Jev vs regular Luna compaction + follow-up benchmark",
    "",
    `This report records ${rows.length} attempted compactions, up to ${MAX_FOLLOWUPS} follow-up model calls, and three synthetic fixtures. The regular Luna path is the paired baseline.`,
    "",
    "Context sizes use the same deterministic token heuristic for both paths, not the provider tokenizer or billing count. Each successful context received two concurrent but independent follow-up calls; each call saw only that context, its question, and its JSON schema. No original messages or oracle values were passed to follow-up calls.",
    "",
    "## Paired results",
    "",
    "| case | path | compaction outcome | true Jev prune | compaction ms | summary calls | Jev HTTP actual | context tokens before → final (savings) | follow-up correctness | safety violations | follow-up median ms |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const fixture of fixtures) {
    for (const pipeline of ["jev", "regular-luna"] as const) {
      const row = rows.find(
        (candidate) => candidate.case === fixture.name && candidate.pipeline === pipeline,
      );
      const compaction = isRecord(row?.compaction) ? row.compaction : {};
      const requests = isRecord(row?.requests) ? row.requests : {};
      const status = isRecord(row?.status)
        ? `${String(row.status.outcome ?? "unknown")}/${String(row.status.path ?? "unknown")}`
        : "failed";
      const tasks = Array.isArray(row?.taskScores) ? row.taskScores.filter(isRecord) : [];
      const correct = tasks.reduce((sum, task) => sum + (finite(task.correctFields) ?? 0), 0);
      const total = tasks.reduce((sum, task) => sum + (finite(task.totalFields) ?? 0), 0);
      const violations = tasks.reduce(
        (sum, task) =>
          sum + (Array.isArray(task.safetyViolations) ? task.safetyViolations.length : 0),
        0,
      );
      const followups = Array.isArray(row?.followups) ? row.followups.filter(isRecord) : [];
      const followupMedian = median(
        followups
          .map((item) => finite(item.ms))
          .filter((value): value is number => value !== undefined),
      );
      const context =
        compaction.succeeded === true
          ? `${finite(compaction.beforeTokensEstimate) ?? "n/a"} → ${finite(compaction.finalTokensEstimate) ?? "n/a"} (${((finite(compaction.savingsPercentEstimate) ?? 0) * 100).toFixed(1)}%)`
          : "n/a (0 savings; not scored)";
      lines.push(
        `| ${fixture.name} | ${pipeline} | ${status} | ${compaction.trueJevPruning === true ? "yes" : "no"} | ${finite(compaction.elapsedMs) ?? "n/a"} | ${Array.isArray(requests.summaryModelRequests) ? requests.summaryModelRequests.length : 0} | ${Array.isArray(requests.jevEvents) ? requests.jevEvents.length : 0} | ${context} | ${tasks.length ? `${correct}/${total}` : "not run"} | ${violations} | ${followupMedian ?? "n/a"} |`,
      );
    }
  }
  lines.push(
    "",
    "## Jev minus regular Luna",
    "",
    "| case | compaction ms delta | final token estimate delta | follow-up field-score delta | true Jev prune |",
    "| --- | ---: | ---: | ---: | --- |",
  );
  for (const fixture of fixtures) {
    const jev = rows.find((row) => row.case === fixture.name && row.pipeline === "jev");
    const regular = rows.find(
      (row) => row.case === fixture.name && row.pipeline === "regular-luna",
    );
    const jevCompaction = isRecord(jev?.compaction) ? jev.compaction : {};
    const regularCompaction = isRecord(regular?.compaction) ? regular.compaction : {};
    const score = (row: JsonRecord | undefined) => {
      const scores = Array.isArray(row?.taskScores) ? row.taskScores.filter(isRecord) : [];
      const fields = scores.reduce((sum, item) => sum + (finite(item.correctFields) ?? 0), 0);
      const total = scores.reduce((sum, item) => sum + (finite(item.totalFields) ?? 0), 0);
      return total > 0 ? (fields / total) * 100 : undefined;
    };
    const tokenDelta = delta(
      finite(jevCompaction.finalTokensEstimate),
      finite(regularCompaction.finalTokensEstimate),
    );
    lines.push(
      `| ${fixture.name} | ${delta(finite(jevCompaction.elapsedMs), finite(regularCompaction.elapsedMs))} ms | ${tokenDelta} tokens | ${delta(score(jev), score(regular))} percentage points | ${jevCompaction.trueJevPruning === true ? "yes" : "no"} |`,
    );
  }
  lines.push(
    "",
    "## Resource comparison",
    "",
    "CPU and end-of-child memory are process-level samples; network-bound wall time is the primary comparison.",
    "",
    "| case | CPU Jev → regular (ms) | RSS Jev → regular (MiB) | heap Jev → regular (MiB) |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const fixture of fixtures) {
    const jev = rows.find((row) => row.case === fixture.name && row.pipeline === "jev");
    const regular = rows.find(
      (row) => row.case === fixture.name && row.pipeline === "regular-luna",
    );
    const jevRuntime = isRecord(jev?.runtime) ? jev.runtime : {};
    const regularRuntime = isRecord(regular?.runtime) ? regular.runtime : {};
    const cpu = (runtime: JsonRecord) =>
      (finite(runtime.cpuUserMs) ?? 0) + (finite(runtime.cpuSystemMs) ?? 0);
    const pair = (left: number | undefined, right: number | undefined, scale = 1) =>
      left === undefined || right === undefined
        ? "n/a"
        : `${(left / scale).toFixed(1)} → ${(right / scale).toFixed(1)} (${delta(left / scale, right / scale)})`;
    lines.push(
      `| ${fixture.name} | ${pair(cpu(jevRuntime), cpu(regularRuntime))} | ${pair(finite(jevRuntime.rssBytesAtEnd), finite(regularRuntime.rssBytesAtEnd), 1024 * 1024)} | ${pair(finite(jevRuntime.heapUsedBytesAtEnd), finite(regularRuntime.heapUsedBytesAtEnd), 1024 * 1024)} |`,
    );
  }
  lines.push(
    "## Evidence and limits",
    "",
    "- There is one paired observation per fixture (three pairs total), not repeated samples; treat timing deltas as directional, not a statistical performance claim.",
    "- A Jev cell is called true pruning only when the extension reported outcome `pruned` and path `prune`. Checkpoint/fallback outcomes are reported separately.",
    "- Failed compactions receive zero savings, no retention/accuracy score, and no follow-up outputs. Malformed answers are scored once and never retried.",
    "- Gateway failover is counted as each observed HTTP request, separately from logical compaction attempts. No provider error body or credentials are persisted.",
    "- Compaction/follow-up latency and process CPU plus end-of-child RSS/heap are recorded. Allocation counts are not collected; this is a network-bound model benchmark.",
    "- Successful summaries and model answers are persisted as synthetic text for manual review. Original synthetic input transcripts are not included.",
    `- ${report.authorization && isRecord(report.authorization) ? (finite(report.authorization.followupCallsExecuted) ?? 0) : 0} follow-up model requests executed of ${MAX_FOLLOWUPS} authorized; requests are not retried.`,
  );
  return lines.join("\n");
}

async function parseArgs(): Promise<{ output: string }> {
  const args = process.argv.slice(2);
  const index = args.indexOf("--output");
  if (index >= 0 && (!args[index + 1] || args[index + 1]!.startsWith("--")))
    throw new Error("--output requires a path");
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return {
    output: resolve(index >= 0 ? args[index + 1]! : join(REPORT_ROOT, timestamp, "results.json")),
  };
}

async function main(): Promise<void> {
  const args = await parseArgs();
  const beforeStatus = await gitStatus();
  const fixtures = makeFixtures();
  const fixtureRoot = await mkdtemp(join(tmpdir(), "paired-luna-fixtures-"));
  const started = performance.now();
  const deadline = started + TOTAL_BUDGET_MS;
  const rows: JsonRecord[] = [];
  let compactionsReserved = 0;
  let followupCallsObserved = 0;
  let interrupted: string | undefined;
  try {
    for (const fixture of fixtures)
      await writeFile(
        join(fixtureRoot, `${fixture.name}.json`),
        JSON.stringify(serializeFixtureForChild(fixture)),
      );
    outer: for (const [fixtureIndex, fixture] of fixtures.entries()) {
      const fixturePath = join(fixtureRoot, `${fixture.name}.json`);
      for (const pipeline of pipelineOrderForCase(fixtureIndex)) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          interrupted = "total-15-minute-budget-exhausted";
          break outer;
        }
        if (compactionsReserved >= MAX_COMPACTIONS) {
          interrupted = "compaction-budget-exhausted";
          break outer;
        }
        compactionsReserved += 1;
        const outputPath = join(fixtureRoot, `${fixture.name}-${pipeline}.json`);
        const runner = await runChild(
          pipeline,
          fixturePath,
          outputPath,
          Math.min(CHILD_TIMEOUT_MS, remaining),
        );
        const row = await readOutput(outputPath, runner, pipeline, fixture);
        const rawFollowupCount = isRecord(row.requests)
          ? (finite(row.requests.followupCalls) ?? 0)
          : 0;
        if (followupCallsObserved + rawFollowupCount > MAX_FOLLOWUPS)
          throw new Error("global follow-up call budget exceeded");
        followupCallsObserved += rawFollowupCount;
        const scores = fixture.tasks.map((task) => {
          const followups = Array.isArray(row.followups) ? row.followups.filter(isRecord) : [];
          const answer = followups.find((entry) => entry.id === task.id);
          return scoreAnswer(
            task,
            typeof answer?.answerText === "string" ? answer.answerText : undefined,
          );
        });
        rows.push({ ...row, taskScores: scores });
        if (runner.timedOut) {
          interrupted = "child-timeout-no-retry";
          break outer;
        }
      }
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
  const afterStatus = await gitStatus();
  const report: JsonRecord = {
    schemaVersion: 1,
    benchmark: "fast-jev-compaction-paired-luna-followup",
    evidenceStatus:
      rows.length === 6 && rows.every((row) => row.ok === true) ? "complete" : "partial-or-failed",
    scope:
      "three synthetic fixtures × Fast Jev and direct regular Luna compaction; two isolated follow-up tasks per successful compacted context",
    authorization: {
      paidLiveCalls: true,
      syntheticOnly: true,
      maxCompactions: MAX_COMPACTIONS,
      compactionsReserved,
      compactionRows: rows.length,
      maxFollowupModelCalls: MAX_FOLLOWUPS,
      followupCallsExecuted: followupCallsObserved,
      retries: 0,
      interrupted,
      privateTranscripts: false,
    },
    model: {
      reference: MODEL_REFERENCE,
      summary: "summarizePreparedWithModel",
      answerSettings: {
        maxTokens: ANSWER_MAX_TOKENS,
        reasoningEffort: "low",
        cacheRetention: "none",
        maxRetries: 0,
      },
    },
    runtime: {
      pi: "0.87.0",
      timeoutMs: BENCHMARK_TIMEOUTS,
      sequentialCompactionRows: true,
      followupCallsPerSuccessfulContext: 2,
      followupsIndependentAndConcurrentWithinContext: true,
      totalWallMs: Math.max(0, Math.round(performance.now() - started)),
    },
    fixtureProtocol: fixtures.map((fixture) => ({
      name: fixture.name,
      description: fixture.description,
      tasks: fixture.tasks.map(({ id, question, oracle }) => ({ id, question, oracle })),
      oldMessageCount: fixture.oldMessages.length,
      tailMessageCount: fixture.tailMessages.length,
      previousSummaryIncluded: Boolean(fixture.previousSummary),
    })),
    ordering: {
      pathOrderByCase: Object.fromEntries(
        fixtures.map((fixture, index) => [fixture.name, pipelineOrderForCase(index)]),
      ),
      noInterCompactionConcurrency: true,
    },
    sideEffects: { scopedStatusUnchanged: beforeStatus === afterStatus },
    runs: rows,
  };
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
  await writeFile(
    join(dirname(args.output), "results.md"),
    resultsMarkdown(report, fixtures) + "\n",
  );
  console.log(
    JSON.stringify({
      output: args.output,
      markdown: join(dirname(args.output), "results.md"),
      compactions: compactionsReserved,
      followupCalls: followupCallsObserved,
      interrupted,
      runs: rows.map((row) => ({
        case: row.case,
        pipeline: row.pipeline,
        ok: row.ok,
        outcome: isRecord(row.status) ? row.status.outcome : undefined,
        trueJevPruning: isRecord(row.compaction) ? row.compaction.trueJevPruning : undefined,
        followups: isRecord(row.requests) ? row.requests.followupCalls : undefined,
      })),
    }),
  );
}

if (import.meta.main) await main();
