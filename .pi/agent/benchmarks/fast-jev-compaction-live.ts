#!/usr/bin/env bun
/**
 * Bounded live benchmark for the Pi fast-Jev compactor and
 * tamaratran/fast-jev-compaction.
 *
 * The pilot already consumed one run per pipeline. Each --repeat adds one run per
 * pipeline for each of the three synthetic cases. Runs are sequential, never
 * retried, and emit only sanitized metrics.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify((await import("node:child_process")).execFile);
const REPO = resolve(dirname(import.meta.path), "../../..");
const OURS_MODULE = resolve(REPO, ".pi/agent/extensions/fast-jev-compaction/index.ts");
const GATEWAY_MODULE = resolve(REPO, ".pi/agent/lib/jev-gateway.ts");
const PINNED_COMMIT = "e3f262a7f4d42bd8dd32ced30d26176f7cb545b0";
const PI_MODEL = "openai-codex/gpt-6-luna";
const RESERVE_TOKENS = 4_000;
const JEV_TIMEOUT_MS = 2_400;
const LUNA_TIMEOUT_MS = 60_000;
const CHILD_TIMEOUT_MS = 90_000;
const TOTAL_BUDGET_MS = 720_000;
const MAX_ADDITIONAL_RUNS = 12;
const PILOT_RUNS = 2;
const PRIOR_EXPANDED_RUNS = 12;
const PRIOR_CENSORED_RUNS = PILOT_RUNS + PRIOR_EXPANDED_RUNS;

export const BENCHMARK_TIMEOUTS = {
  jevMs: JEV_TIMEOUT_MS,
  lunaMs: LUNA_TIMEOUT_MS,
  childMs: CHILD_TIMEOUT_MS,
  totalBudgetMs: TOTAL_BUDGET_MS,
} as const;
const UPSTREAM_REDUCTION_GATE = 0.25;
const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";
const REPORT_ROOT = join(
  process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? tmpdir(), ".local", "state"),
  "dotfiles",
  "pi-benchmarks",
  "fast-jev-compaction-live",
);

type Pipeline = "ours" | "upstream";
type CaseName =
  | "read-heavy-prunable"
  | "protected-error-action-heavy"
  | "conversation-prior-summary";
type JsonRecord = Record<string, unknown>;

export interface MarkerGroups {
  readonly goal: readonly string[];
  readonly action: readonly string[];
  readonly error: readonly string[];
  readonly priorCommitment: readonly string[];
}

export interface FixtureCase {
  readonly name: CaseName;
  readonly description: string;
  readonly previousSummary: string;
  readonly oldMessages: readonly unknown[];
  readonly tailMessages: readonly unknown[];
  readonly requiredMarkers: MarkerGroups;
  readonly disposableMarkers: readonly string[];
  readonly routineDroppableMarkers: readonly string[];
  readonly tailMessageCount: number;
}

interface ChildResult {
  readonly elapsedMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

function textBlock(text: string): { type: "text"; text: string }[] {
  return [{ type: "text", text }];
}

function plainMessage(role: "user" | "assistant", text: string): JsonRecord {
  return { role, content: textBlock(text) };
}

function toolPair(options: {
  readonly index: number;
  readonly name: string;
  readonly input: JsonRecord;
  readonly result: string;
  readonly isError: boolean;
}): unknown[] {
  const id = `${options.name}-${options.index}`;
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: `Running ${options.name} for synthetic case ${options.index}.` },
        { type: "toolCall", id, name: options.name, arguments: options.input },
      ],
    },
    {
      role: "toolResult",
      toolCallId: id,
      content: textBlock(options.result),
      isError: options.isError,
    },
  ];
}

function readPair(index: number): unknown[] {
  const routineMarker = index === 0 ? "FACT-READ-OLD-ROUTINE-0\n" : "";
  const body = [
    routineMarker,
    `FACT-READ-OLD-ROUTINE-${index}`,
    `synthetic read result ${index}; safe to recreate; no private data.`,
    "const generated = true;",
    "routine listing ".repeat(110),
  ].join("\n");
  return toolPair({
    index,
    name: "read",
    input: { path: `synthetic/file-${index}.ts` },
    result: body,
    isError: false,
  });
}

function normalizeGroups(groups: MarkerGroups): MarkerGroups {
  return {
    goal: [...new Set(groups.goal)],
    action: [...new Set(groups.action)],
    error: [...new Set(groups.error)],
    priorCommitment: [...new Set(groups.priorCommitment)],
  };
}

export function normalizeFixture(fixture: FixtureCase): FixtureCase {
  const requiredMarkers = normalizeGroups(fixture.requiredMarkers);
  const required = new Set(Object.values(requiredMarkers).flat());
  const disposableMarkers = [...new Set(fixture.disposableMarkers)];
  const overlap = disposableMarkers.find((marker) => required.has(marker));
  if (overlap !== undefined)
    throw new Error(`fixture marker is both required and disposable: ${overlap}`);
  const routineOverlap = fixture.routineDroppableMarkers.find((marker) => required.has(marker));
  if (routineOverlap !== undefined)
    throw new Error(`routine marker is required: ${routineOverlap}`);
  return {
    ...fixture,
    previousSummary: fixture.previousSummary.trim(),
    requiredMarkers,
    disposableMarkers,
    routineDroppableMarkers: [...new Set(fixture.routineDroppableMarkers)],
    tailMessageCount: fixture.tailMessages.length,
  };
}

function makeReadHeavyFixture(): FixtureCase {
  const oldMessages: unknown[] = [
    plainMessage(
      "user",
      "Read the synthetic files and keep the migration goal visible. FACT-READ-USER-GOAL",
    ),
  ];
  for (let index = 0; index < 12; index += 1) oldMessages.push(...readPair(index));
  const tailMessages = [
    plainMessage("assistant", "The remaining work is to verify the final generated diff."),
    plainMessage("user", "Continue with the verification. FACT-READ-TAIL-KEEP"),
  ];
  return {
    name: "read-heavy-prunable",
    description: "Twelve large read results with a retained migration goal and tail action.",
    previousSummary: "",
    oldMessages,
    tailMessages,
    requiredMarkers: {
      goal: ["FACT-READ-USER-GOAL"],
      action: ["FACT-READ-TAIL-KEEP"],
      error: [],
      priorCommitment: [],
    },
    disposableMarkers: Array.from({ length: 12 }, (_, index) => `FACT-READ-OLD-ROUTINE-${index}`),
    routineDroppableMarkers: ["FACT-READ-OLD-ROUTINE-0"],
    tailMessageCount: tailMessages.length,
  };
}

function makeProtectedFixture(): FixtureCase {
  const oldMessages: unknown[] = [
    plainMessage(
      "user",
      "Repair the migration without losing the protected action history. FACT-PROTECTED-GOAL",
    ),
  ];
  const tools = ["bash", "write", "apply_patch", "edit", "deploy", "git", "exec", "publish"];
  for (let index = 0; index < tools.length; index += 1) {
    const isError = index % 2 === 0;
    oldMessages.push(
      ...toolPair({
        index,
        name: tools[index],
        input: {
          target: `synthetic/protected-${index}.txt`,
          action: isError ? "failed-check" : "apply-change",
        },
        result: [
          `FACT-PROTECTED-DISPOSABLE-${isError ? "ERROR" : "ACTION"}-${index}`,
          isError
            ? "synthetic command failed; preserve the failure context."
            : "synthetic action completed; rerun is not assumed safe.",
          "protected operation detail ".repeat(100),
        ].join("\n"),
        isError,
      }),
    );
  }
  const tailMessages = [
    plainMessage(
      "assistant",
      "The next action must preserve the rollback boundary. FACT-PROTECTED-ACTION",
    ),
    plainMessage(
      "user",
      "The failed validation remains part of the explanation. FACT-PROTECTED-ERROR",
    ),
    plainMessage(
      "assistant",
      "Keep the migration commitment visible through the final diff. FACT-PROTECTED-COMMITMENT",
    ),
  ];
  return {
    name: "protected-error-action-heavy",
    description:
      "Protected write/action calls and failed results with durable facts in the retained tail.",
    previousSummary: "",
    oldMessages,
    tailMessages,
    requiredMarkers: {
      goal: ["FACT-PROTECTED-GOAL"],
      action: ["FACT-PROTECTED-ACTION"],
      error: ["FACT-PROTECTED-ERROR"],
      priorCommitment: ["FACT-PROTECTED-COMMITMENT"],
    },
    disposableMarkers: tools.map(
      (_, index) => `FACT-PROTECTED-DISPOSABLE-${index % 2 === 0 ? "ERROR" : "ACTION"}-${index}`,
    ),
    routineDroppableMarkers: [],
    tailMessageCount: tailMessages.length,
  };
}

function makeConversationFixture(): FixtureCase {
  const previousSummary = [
    "Prior durable facts from the previous checkpoint:",
    "FACT-CONVERSATION-PRIOR-GOAL: migrate the configuration without changing the public contract.",
    "FACT-CONVERSATION-PRIOR-ACTION: verify the generated diff before applying it.",
    "FACT-CONVERSATION-PRIOR-ERROR: the previous validation failed on the protected path.",
    "FACT-CONVERSATION-PRIOR-COMMITMENT: preserve the rollback plan and report the final check.",
  ].join("\n");
  const oldMessages: unknown[] = [
    plainMessage("user", "We need to continue the migration discussion."),
    plainMessage("assistant", "The design has two viable directions; compare their tradeoffs."),
  ];
  for (let index = 0; index < 14; index += 1) {
    oldMessages.push(
      plainMessage(
        index % 2 === 0 ? "user" : "assistant",
        `${index % 2 === 0 ? "Can we revisit" : "The discussion notes"} the compatibility detail ${index}? ${
          index === 4 ? "FACT-CONVERSATION-DISPOSABLE" : ""
        } ${"conversation detail ".repeat(75)}`,
      ),
    );
  }
  const tailMessages = [
    plainMessage("assistant", "The final decision still needs to name the verification step."),
    plainMessage("user", "Keep the current decision visible. FACT-CONVERSATION-TAIL-KEEP"),
  ];
  return {
    name: "conversation-prior-summary",
    description:
      "Conversation-heavy input with a prior summary carrying durable goal, action, error, and commitment facts.",
    previousSummary,
    oldMessages,
    tailMessages,
    requiredMarkers: {
      goal: ["FACT-CONVERSATION-PRIOR-GOAL"],
      action: ["FACT-CONVERSATION-PRIOR-ACTION"],
      error: ["FACT-CONVERSATION-PRIOR-ERROR"],
      priorCommitment: ["FACT-CONVERSATION-PRIOR-COMMITMENT"],
    },
    disposableMarkers: ["FACT-CONVERSATION-DISPOSABLE"],
    routineDroppableMarkers: [],
    tailMessageCount: tailMessages.length,
  };
}

export function makeFixtures(): readonly FixtureCase[] {
  return [makeReadHeavyFixture(), makeProtectedFixture(), makeConversationFixture()].map(
    normalizeFixture,
  );
}

export function pipelineOrderForRepeat(repeat: number): readonly Pipeline[] {
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat must be a positive integer");
  return repeat % 2 === 1 ? ["ours", "upstream"] : ["upstream", "ours"];
}

function commandOutput(value: string): string {
  return value.trim();
}

async function gitHead(directory: string): Promise<string> {
  const result = await execFile("git", ["-C", directory, "rev-parse", "HEAD"], {
    maxBuffer: 1024 * 1024,
  });
  return commandOutput(result.stdout);
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

function defaultOutput(): string {
  return join(REPORT_ROOT, "results.json");
}

function parseArgs(): { upstreamDir: string; output: string; repeats: number } {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const upstreamDir = value("--upstream-dir");
  if (!upstreamDir)
    throw new Error("--upstream-dir is required; pass the already-fetched pinned read-only clone");
  const repeats = Number(value("--repeat") ?? "2");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats * 6 > MAX_ADDITIONAL_RUNS) {
    throw new Error(`--repeat must produce between 1 and ${MAX_ADDITIONAL_RUNS} additional runs`);
  }
  return {
    upstreamDir: resolve(upstreamDir),
    output: resolve(value("--output") ?? defaultOutput()),
    repeats,
  };
}

function pathFile(value: string): string {
  return pathToFileURL(value).href;
}

function extensionSource(paths: {
  upstreamIndex: string;
  oursModule: string;
  gatewayModule: string;
}): string {
  const q = (value: string) => JSON.stringify(pathFile(value));
  return `
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import * as oursFns from ${q(paths.oursModule)};
import * as gatewayFns from ${q(paths.gatewayModule)};
import * as upstream from ${q(paths.upstreamIndex)};

const INPUT = process.env.BENCH_INPUT;
const OUTPUT = process.env.BENCH_OUTPUT;
const PIPELINE = process.env.BENCH_PIPELINE;
const CASE_NAME = process.env.BENCH_CASE;
const REPEAT = Number(process.env.BENCH_REPEAT ?? "0");
const SUMMARY_MODEL = ${JSON.stringify(PI_MODEL)};
const RESERVE_TOKENS = ${RESERVE_TOKENS};
const JEV_TIMEOUT_MS = ${JEV_TIMEOUT_MS};
const LUNA_TIMEOUT_MS = ${LUNA_TIMEOUT_MS};
const UPSTREAM_REDUCTION_GATE = ${UPSTREAM_REDUCTION_GATE};
const SUMMARY_PREFIX = ${JSON.stringify(SUMMARY_PREFIX)};
const SUMMARY_SUFFIX = ${JSON.stringify(SUMMARY_SUFFIX)};
const TOKEN_PIECES = /[A-Za-z]+|\\d+|[^\\sA-Za-z\\d]/g;

function estimateTokens(text) {
  let tokens = 0;
  for (const [piece] of text.matchAll(TOKEN_PIECES)) {
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
function toBenchmarkMessage(raw) {
  if (raw?.role === "toolResult") return { role: "user", text: "", toolCalls: [], toolResults: [{ toolUseId: raw.toolCallId, text: contentText(raw.content), isError: raw.isError === true }] };
  const calls = Array.isArray(raw?.content) ? raw.content.filter((part) => part?.type === "toolCall").map((part) => ({ toolUseId: part.id, name: part.name, input: part.arguments ?? {} })) : [];
  const text = Array.isArray(raw?.content) ? raw.content.filter((part) => part?.type === "text").map((part) => part.text).join("\\n") : "";
  return { role: raw?.role === "assistant" ? "assistant" : "user", text, toolCalls: calls, toolResults: [] };
}
function renderMessage(message) {
  const lines = [];
  const role = message?.role === "assistant" ? "Assistant" : "User";
  if (typeof message?.text === "string" && message.text.length > 0) lines.push("[" + role + "]: " + message.text);
  for (const call of message?.toolCalls ?? []) lines.push("[Assistant tool calls]: " + call.name + "(" + JSON.stringify(call.input) + ")");
  for (const result of message?.toolResults ?? []) lines.push("[Tool result" + (result.isError ? " · error" : "") + "]: " + result.text);
  return lines.join("\\n\\n");
}
function renderMessages(messages) { return messages.map((message) => renderMessage(message && Array.isArray(message.toolCalls) ? message : toBenchmarkMessage(message))).filter(Boolean).join("\\n\\n"); }
function wrap(summary) { return SUMMARY_PREFIX + summary + SUMMARY_SUFFIX; }
function occurrences(text, marker) { let count = 0; let offset = 0; while (true) { const index = text.indexOf(marker, offset); if (index < 0) return count; count += 1; offset = index + marker.length; } }
function usage(value) {
  if (!value || typeof value !== "object") return undefined;
  const aliases = { input: ["input", "input_tokens", "inputTokens"], output: ["output", "output_tokens", "outputTokens"], totalTokens: ["totalTokens", "total_tokens"], cacheRead: ["cacheRead", "cache_read", "cache_read_tokens"], cacheWrite: ["cacheWrite", "cache_write", "cache_write_tokens"] };
  const result = {};
  for (const [target, keys] of Object.entries(aliases)) for (const key of keys) if (typeof value[key] === "number" && Number.isFinite(value[key])) { result[target] = value[key]; break; }
  return Object.keys(result).length ? result : undefined;
}
function errorClass(value) {
  const record = value && (typeof value === "object" || typeof value === "function") ? value : {};
  const result = {};
  if (typeof record.name === "string") result.exceptionType = ["AbortError", "TimeoutError", "ModelsError", "PiMessagesResponseError", "CodexApiError", "CodexProtocolError", "WebSocketCloseError", "TypeError", "Error"].includes(record.name) ? record.name : "other";
  for (const key of ["status", "statusCode", "httpStatus"]) if (Number.isInteger(record[key])) { result.httpStatus = record[key]; break; }
  if (typeof record.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(record.code)) result.providerCode = record.code;
  return Object.keys(result).length ? result : { exceptionType: "other" };
}
function modelRoute(model) {
  const provider = model && typeof model.provider === "string" ? model.provider : model && typeof model.providerId === "string" ? model.providerId : "registry";
  if (provider.toLowerCase().includes("openrouter")) return "openrouter";
  if (provider.toLowerCase().includes("gateway")) return "vercel-ai-gateway";
  return provider;
}
function modelContextText(summary, tail) { return wrap(summary) + "\\n\\n" + renderMessages(tail); }
async function runLuna(ctx, messages, previousSummary, counters) {
  const started = performance.now();
  counters.lunaCalls += 1;
  const registry = ctx.modelRegistry;
  const model = registry.find("openai-codex", "gpt-6-luna");
  if (!model) return { failureReason: "summary-model-missing" };
  const delegated = Object.create(registry);
  const originalComplete = registry.complete.bind(registry);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LUNA_TIMEOUT_MS);
  delegated.complete = async (requestModel, context, options = {}) => {
    const event = { provider: modelRoute(requestModel), ok: false };
    const requestStarted = performance.now();
    counters.lunaEvents.push(event);
    counters.lunaRequests += 1;
    try {
      const result = await originalComplete(requestModel, context, { ...options, maxRetries: 0, signal: controller.signal });
      event.ok = true;
      event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
      event.usage = usage(result?.usage);
      return result;
    } catch (error) {
      event.ms = Math.max(0, Math.round(performance.now() - requestStarted));
      event.failure = errorClass(error);
      throw error;
    }
  };
  try {
    const summaryCtx = { ...ctx, modelRegistry: delegated };
    const result = await oursFns.summarizePreparedWithModel(summaryCtx, SUMMARY_MODEL, messages, previousSummary, RESERVE_TOKENS, undefined, controller.signal);
    counters.lunaMs += Math.max(0, Math.round(performance.now() - started));
    if (result && result.usage) counters.lunaUsage.push(usage(result.usage));
    if (result && result.failureReason) counters.lunaFailureReasons.push(result.failureReason);
    return result;
  } catch (error) {
    counters.lunaMs += Math.max(0, Math.round(performance.now() - started));
    counters.lunaFailureReasons.push("summary-auth-provider-failed");
    return { failureReason: "summary-auth-provider-failed", diagnostics: errorClass(error) };
  } finally {
    clearTimeout(timeout);
  }
}
async function observedFetch(counters, input, init) {
  const started = performance.now();
  const url = String(input);
  const provider = url.includes("openrouter") ? "openrouter" : url.includes("ai-gateway") ? "vercel-ai-gateway" : "other";
  const bodyText = typeof init?.body === "string" ? init.body : undefined;
  const event = { provider, bodyBytes: bodyText === undefined ? undefined : new TextEncoder().encode(bodyText).byteLength, inputTokensEstimate: bodyText === undefined ? undefined : estimateTokens(bodyText) };
  counters.jevHttp.push(event);
  try {
    const response = await fetch(input, init);
    event.status = response.status;
    event.ok = response.ok;
    event.ms = Math.max(0, Math.round(performance.now() - started));
    try { event.usage = usage(await response.clone().json().then((body) => body?.usage)); } catch (_error) { event.usage = undefined; }
    return response;
  } catch (error) {
    event.ms = Math.max(0, Math.round(performance.now() - started));
    event.failure = errorClass(error);
    throw error;
  }
}
function upstreamMessages(rawMessages) {
  return rawMessages.map((raw) => {
    if (raw?.role === "toolResult") return { role: "user", text: "", toolUses: [], toolResults: [{ tool_use_id: raw.toolCallId, text: contentText(raw.content), isError: raw.isError === true }] };
    const toolUses = Array.isArray(raw?.content) ? raw.content.filter((part) => part?.type === "toolCall").map((part) => ({ tool_use_id: part.id, tool: part.name, input: part.arguments ?? {} })) : [];
    const text = Array.isArray(raw?.content) ? raw.content.filter((part) => part?.type === "text").map((part) => part.text).join("\\n") : "";
    return { role: raw?.role === "assistant" ? "assistant" : "user", text, toolUses };
  });
}
function upstreamToBenchmark(messages) {
  return messages.map((message) => ({ role: message.role, text: message.text, toolCalls: (message.toolUses ?? []).map((call) => ({ name: call.tool, input: call.input })), toolResults: (message.toolResults ?? []).map((result) => ({ text: result.text, isError: result.isError })) }));
}
async function run() {
  if (!INPUT || !OUTPUT || !PIPELINE || !CASE_NAME) throw new Error("missing benchmark environment");
  const fixture = JSON.parse(await readFile(INPUT, "utf8"));
  const counters = { jevHttp: [], lunaCalls: 0, lunaRequests: 0, lunaMs: 0, lunaEvents: [], lunaUsage: [], lunaFailureReasons: [] };
  const started = performance.now();
  const oldMessages = fixture.oldMessages;
  const tailMessages = fixture.tailMessages;
  const previousSummary = fixture.previousSummary || "";
  const baselineText = (previousSummary ? wrap(previousSummary) + "\\n\\n" : "") + renderMessages([...oldMessages, ...tailMessages]);
  let outputSummary;
  let finalText;
  let compactionSucceeded = false;
  let status;
  let logicalResult;
  let compactorError;
  if (PIPELINE === "ours") {
    const preparation = {
      messagesToSummarize: oldMessages,
      turnPrefixMessages: [],
      isSplitTurn: false,
      firstKeptEntryId: "expanded-tail-0",
      tokensBefore: estimateTokens(baselineText),
      previousSummary: previousSummary || undefined,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: RESERVE_TOKENS, keepRecentTokens: 20_000 },
    };
    const result = await oursFns.runFastJevCompaction(preparation, [], {
      modelRegistry: ctx.modelRegistry,
      fetch: (input, init) => observedFetch(counters, input, init),
      summarizeCheckpoint: (messages, previous) => runLuna(ctx, messages, previous, counters),
      onStatus: (value) => { status = { outcome: value.outcome, path: value.path, reason: value.reason, jevMs: value.jevMs, summaryMs: value.summaryMs, totalMs: value.totalMs, calls: value.calls }; },
    });
    logicalResult = result ? { summaryChars: result.summary.length, path: result.details.fastJev.attempt.path } : undefined;
    if (result) {
      compactionSucceeded = true;
      outputSummary = result.summary;
      finalText = modelContextText(result.summary, tailMessages);
    } else finalText = baselineText;
  } else {
    const messages = upstreamMessages([...(previousSummary ? [{ role: "user", content: [{ type: "text", text: previousSummary }] }] : []), ...oldMessages, ...tailMessages]);
    const ask = { ask: async (state, questions) => {
      const gateway = await gatewayFns.requestJevGateway(ctx.modelRegistry, { state, questions }, { timeoutMs: JEV_TIMEOUT_MS, fetch: (input, init) => observedFetch(counters, input, init) });
      if (!gateway.ok) throw new Error("jev gateway failure");
      return gateway.value;
    } };
    try {
      const result = await upstream.compact(messages, ask, { keepThreshold: 0.7, preserveRecentMessages: fixture.tailMessageCount });
      const nativeReduction = result.stats.charsBefore === 0 ? 0 : (result.stats.charsBefore - result.stats.charsAfter) / result.stats.charsBefore;
      logicalResult = { path: "message-array", messagesBefore: result.stats.messagesBefore, messagesAfter: result.stats.messagesAfter, charsBefore: result.stats.charsBefore, charsAfter: result.stats.charsAfter, reduction: nativeReduction, requests: result.stats.requests, nativeOutputPreserved: nativeReduction >= UPSTREAM_REDUCTION_GATE };
      if (nativeReduction < UPSTREAM_REDUCTION_GATE) {
        compactorError = { kind: "upstream-no-savings-gate", gate: UPSTREAM_REDUCTION_GATE };
        const summary = await runLuna(ctx, oldMessages, previousSummary, counters);
        status = { outcome: "fallback", path: "regular-luna", reason: "no-savings", gate: UPSTREAM_REDUCTION_GATE, nativeReduction, requests: result.stats.requests };
        if (summary && typeof summary.text === "string") {
          compactionSucceeded = true;
          outputSummary = summary.text;
          finalText = modelContextText(summary.text, tailMessages);
        } else finalText = baselineText;
      } else {
        const finalMessages = upstreamToBenchmark(result.messages);
        compactionSucceeded = true;
        finalText = renderMessages(finalMessages);
        status = { outcome: "compacted", path: "message-array", calls: result.stats.calls, requests: result.stats.requests, stateTokens: result.stats.stateTokens, reduction: nativeReduction };
      }
    } catch (error) {
      compactorError = errorClass(error);
      const summary = await runLuna(ctx, oldMessages, previousSummary, counters);
      status = { outcome: "fallback", path: "regular-luna", reason: "jev-failed" };
      if (summary && typeof summary.text === "string") {
        compactionSucceeded = true;
        outputSummary = summary.text;
        finalText = modelContextText(summary.text, tailMessages);
      } else finalText = baselineText;
    }
  }
  const totalMs = Math.max(0, Math.round(performance.now() - started));
  const requiredRetention = compactionSucceeded
    ? Object.fromEntries(Object.entries(fixture.requiredMarkers).map(([category, markers]) => [category, Object.fromEntries(markers.map((marker) => [marker, { present: occurrences(finalText, marker) > 0, count: occurrences(finalText, marker) }]))]))
    : undefined;
  const disposableRetention = compactionSucceeded
    ? Object.fromEntries(fixture.disposableMarkers.map((marker) => [marker, { present: occurrences(finalText, marker) > 0, count: occurrences(finalText, marker) }]))
    : undefined;
  const beforeTokens = estimateTokens(baselineText);
  const finalTokens = compactionSucceeded ? estimateTokens(finalText) : beforeTokens;
  const tailText = renderMessages(tailMessages);
  const result = {
    ok: true,
    pipeline: PIPELINE,
    case: CASE_NAME,
    repeat: REPEAT,
    runtime: { mode: ctx.mode, hasUI: ctx.hasUI, registryComplete: typeof ctx.modelRegistry.complete === "function", lunaModel: SUMMARY_MODEL },
    normalization: { oldMessageCount: oldMessages.length, tailMessageCount: tailMessages.length, previousSummaryIncluded: Boolean(previousSummary), previousSummaryOccurrencesInBaseline: previousSummary ? occurrences(baselineText, previousSummary.slice(0, 32)) : 0, fullContextParts: "previous summary once + old messages + tail messages once" },
    summaryContract: { function: "summarizePreparedWithModel", model: SUMMARY_MODEL, reserveTokens: RESERVE_TOKENS, reasoningEffort: "low", cacheRetention: "none", maxRetries: 0, customInstructions: "none", oursInput: "old messages plus previousSummary argument", upstreamFallbackInput: "same old messages plus same previousSummary argument" },
    requests: { jevHttp: counters.jevHttp.length, jevByProvider: counters.jevHttp.reduce((counts, event) => { counts[event.provider] = (counts[event.provider] ?? 0) + 1; return counts; }, {}), luna: counters.lunaCalls, lunaRequests: counters.lunaRequests, fallbackUsed: counters.lunaCalls > 0, gatewayFallbackUsed: counters.jevHttp.some((event) => event.provider === "openrouter"), jevEvents: counters.jevHttp.map((event) => ({ provider: event.provider, status: event.status, ok: event.ok, ms: event.ms, bodyBytes: event.bodyBytes, inputTokensEstimate: event.inputTokensEstimate, usage: event.usage, failure: event.failure })), lunaEvents: counters.lunaEvents.map((event) => ({ provider: event.provider, ok: event.ok, ms: event.ms, usage: event.usage, failure: event.failure })) },
    phases: { compactorMs: totalMs, lunaMs: counters.lunaMs, jevHttpMs: counters.jevHttp.reduce((sum, event) => sum + (event.ms ?? 0), 0), status },
    usage: { jevReported: counters.jevHttp.map((event) => event.usage).filter(Boolean), lunaReported: counters.lunaUsage.filter(Boolean) },
    context: { estimator: "fast-jev upstream estimateTokens heuristic; not provider billing", compactionSucceeded, beforeTokensEstimate: beforeTokens, finalTokensEstimate: finalTokens, savingsTokensEstimate: compactionSucceeded ? beforeTokens - finalTokens : 0, savingsPercentEstimate: compactionSucceeded && beforeTokens > 0 ? (beforeTokens - finalTokens) / beforeTokens : 0, retainedTailTokensEstimate: estimateTokens(tailText), priorSummaryTokensEstimate: estimateTokens(previousSummary ? wrap(previousSummary) : ""), toolFramingIncluded: true, fullContextCountedOnce: true },
    retention: compactionSucceeded
      ? { status: "scored", requiredDurableFacts: requiredRetention, disposableFacts: disposableRetention, routineDroppableMarkers: fixture.routineDroppableMarkers, limitation: "Marker counts are exact-string checks; semantic paraphrase is not credited. Routine markers are disposable, never required." }
      : { status: "not-scored", reason: "compaction-failed", routineDroppableMarkers: fixture.routineDroppableMarkers, limitation: "Retention is not scored when the fallback summary is unavailable; the final context is the unchanged baseline." },
    outcome: { logical: logicalResult, compactorError, compactionSucceeded, summaryReturned: typeof outputSummary === "string", fallbackSummaryStatus: counters.lunaCalls === 0 ? "not-used" : typeof outputSummary === "string" ? "returned" : "missing", fallbackSummaryReason: counters.lunaFailureReasons.at(-1) },
  };
  await writeFile(OUTPUT, JSON.stringify(result));
}
let ctx;
export default function (pi) {
  pi.on("session_start", async (_event, extensionContext) => {
    ctx = extensionContext;
    try { await run(); }
    catch (error) { await writeFile(OUTPUT, JSON.stringify({ ok: false, error: errorClass(error), pipeline: PIPELINE, case: CASE_NAME, repeat: REPEAT })); }
    finally { extensionContext.shutdown(); }
  });
}
`;
}

async function runChild(
  pipeline: Pipeline,
  fixturePath: string,
  fixture: FixtureCase,
  upstreamDir: string,
  outputPath: string,
  repeat: number,
): Promise<ChildResult> {
  const root = await mkdtemp(join(tmpdir(), "fast-jev-live-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "cwd");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  // Symlinks reuse existing auth without copying secrets into the temporary tree.
  await symlink(join(process.env.HOME ?? "", ".pi/agent/auth.json"), join(agentDir, "auth.json"));
  await symlink(
    join(process.env.HOME ?? "", ".pi/agent/models.json"),
    join(agentDir, "models.json"),
  );
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true }));
  await mkdir(join(agentDir, "packages"), { recursive: true });
  const extensionPath = join(root, "benchmark-extension.ts");
  await writeFile(
    extensionPath,
    extensionSource({
      upstreamIndex: resolve(upstreamDir, "src/index.ts"),
      oursModule: OURS_MODULE,
      gatewayModule: GATEWAY_MODULE,
    }),
  );
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
        BENCH_CASE: fixture.name,
        BENCH_REPEAT: String(repeat),
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, CHILD_TIMEOUT_MS);
  const exitCode = await child.exited;
  clearTimeout(timeout);
  const elapsedMs = Math.max(0, Math.round(performance.now() - started));
  await rm(root, { recursive: true, force: true });
  return { elapsedMs, exitCode, timedOut };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRunOutput(
  path: string,
  processResult: ChildResult,
  pipeline: Pipeline,
  fixture: FixtureCase,
  repeat: number,
): Promise<JsonRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isRecord(parsed))
      return { ...parsed, runner: processResult, pipeline, case: fixture.name, repeat };
  } catch (_error) {
    // Missing output is classified below without retaining child diagnostics.
  }
  return {
    ok: false,
    pipeline,
    case: fixture.name,
    repeat,
    error: { exceptionType: "missing-child-output" },
    runner: processResult,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface CompactionMetricScore {
  readonly finalTokensEstimate: number;
  readonly savingsTokensEstimate: number;
  readonly savingsPercentEstimate: number;
  readonly retentionStatus: "scored" | "not-scored";
}

// Failed compactions must not turn a tail-only fallback into a false savings win.
export function scoreCompactionMetrics(input: {
  readonly beforeTokens: number;
  readonly finalTokens: number;
  readonly compactionSucceeded: boolean;
}): CompactionMetricScore {
  if (!input.compactionSucceeded) {
    return {
      finalTokensEstimate: input.beforeTokens,
      savingsTokensEstimate: 0,
      savingsPercentEstimate: 0,
      retentionStatus: "not-scored",
    };
  }
  return {
    finalTokensEstimate: input.finalTokens,
    savingsTokensEstimate: input.beforeTokens - input.finalTokens,
    savingsPercentEstimate:
      input.beforeTokens > 0 ? (input.beforeTokens - input.finalTokens) / input.beforeTokens : 0,
    retentionStatus: "scored",
  };
}

export interface RunCountSummary {
  readonly runs: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly jevHttp: number;
  readonly lunaFallbacks: number;
  readonly lunaRequests: number;
  readonly routes: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
}

export function summarizeRunCounts(rows: readonly JsonRecord[]): RunCountSummary {
  const routes: Record<string, number> = {};
  const errors: Record<string, number> = {};
  let jevHttp = 0;
  let lunaFallbacks = 0;
  let lunaRequests = 0;
  let successfulRuns = 0;
  for (const row of rows) {
    if (row.ok === true) successfulRuns += 1;
    const requests = isRecord(row.requests) ? row.requests : {};
    if (requests.fallbackUsed === true) lunaFallbacks += 1;
    const outcome = isRecord(row.outcome) ? row.outcome : {};
    if (requests.fallbackUsed === true && outcome.summaryReturned !== true) {
      errors["fallback:no-summary"] = (errors["fallback:no-summary"] ?? 0) + 1;
    }
    const jevEvents = arrayValue(requests.jevEvents);
    const lunaEvents = arrayValue(requests.lunaEvents);
    jevHttp += jevEvents.length;
    lunaRequests += numberValue(requests.lunaRequests) ?? lunaEvents.length;
    for (const event of [...jevEvents, ...lunaEvents]) {
      if (!isRecord(event)) continue;
      const kind = jevEvents.includes(event) ? "jev" : "luna";
      const provider = typeof event.provider === "string" ? event.provider : "unknown";
      const routeKey = `${kind}:${provider}`;
      routes[routeKey] = (routes[routeKey] ?? 0) + 1;
      const status = numberValue(event.status);
      const failure = isRecord(event.failure) ? Object.values(event.failure).join("/") : undefined;
      if (event.ok === false || (status !== undefined && status >= 400) || failure !== undefined) {
        const errorKey = `${kind}:${provider}:${status ?? failure ?? "failed"}`;
        errors[errorKey] = (errors[errorKey] ?? 0) + 1;
      }
    }
  }
  return {
    runs: rows.length,
    successfulRuns,
    failedRuns: rows.length - successfulRuns,
    jevHttp,
    lunaFallbacks,
    lunaRequests,
    routes,
    errors,
  };
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function rowsFor(
  rows: readonly JsonRecord[],
  pipeline: Pipeline,
  caseName: CaseName,
): JsonRecord[] {
  return rows.filter((row) => row.pipeline === pipeline && row.case === caseName);
}

function groupedMarkdown(
  rows: readonly JsonRecord[],
  fixtures: readonly FixtureCase[],
  repeats: number,
): string {
  const statistic =
    repeats > 1
      ? `The table reports medians across ${repeats} repeats.`
      : "The table reports the single latest corrected run per cell.";
  const lines = [
    "## Measured summary",
    "",
    `${statistic} Context values use the shared heuristic estimator, not a provider tokenizer. Censored prior results are not included.`,
    "",
    "| case | pipeline | runs | fallback runs | Jev HTTP | Luna requests | compactor ms | before → final estimate | required fact categories retained |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const fixture of fixtures)
    for (const pipeline of ["ours", "upstream"] as const) {
      const group = rowsFor(rows, pipeline, fixture.name);
      const total = summarizeRunCounts(group);
      const times = group
        .map((row) => (isRecord(row.phases) ? numberValue(row.phases.compactorMs) : undefined))
        .filter((value): value is number => value !== undefined);
      const contexts = group
        .map((row) =>
          isRecord(row.context)
            ? [
                numberValue(row.context.beforeTokensEstimate),
                numberValue(row.context.finalTokensEstimate),
              ]
            : undefined,
        )
        .filter(
          (value): value is [number | undefined, number | undefined] =>
            value !== undefined && value[0] !== undefined && value[1] !== undefined,
        );
      const scoredRows = group.filter(
        (row) => isRecord(row.retention) && row.retention.status === "scored",
      );
      const retained = scoredRows.map((row) => {
        const retention =
          isRecord(row.retention) && isRecord(row.retention.requiredDurableFacts)
            ? row.retention.requiredDurableFacts
            : {};
        return Object.entries(retention)
          .filter(
            ([, value]) =>
              isRecord(value) &&
              Object.keys(value).length > 0 &&
              Object.values(value).every((entry) => isRecord(entry) && entry.present === true),
          )
          .map(([key]) => key);
      });
      const retainedCategories = [...new Set(retained.flat())].join(", ");
      const retentionLabel =
        retainedCategories || (scoredRows.length === 0 ? "not scored" : "none");
      const before = median(contexts.map((value) => value[0] as number));
      const final = median(contexts.map((value) => value[1] as number));
      lines.push(
        `| ${fixture.name} | ${pipeline} | ${total.runs} | ${total.lunaFallbacks} | ${total.jevHttp} | ${total.lunaRequests} | ${median(times) ?? "n/a"} | ${before ?? "n/a"} → ${final ?? "n/a"} | ${retentionLabel}${scoredRows.length < group.length ? ` (${group.length - scoredRows.length} not scored)` : ""} |`,
      );
    }
  return lines.join("\n");
}

function fallbackMarkdown(rows: readonly JsonRecord[]): string {
  const lines = [
    "## Fallback checks",
    "",
    "Expected fallback coverage: conversation-heavy for both pipelines, protected error/action-heavy for ours. Upstream uses the explicit 25% benchmark gate for no-savings results; valid native pruning is preserved.",
    "",
    "| case | pipeline | fallback runs / runs | summaries returned | fallback paths |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const caseName of [
    "read-heavy-prunable",
    "protected-error-action-heavy",
    "conversation-prior-summary",
  ] as const)
    for (const pipeline of ["ours", "upstream"] as const) {
      const group = rowsFor(rows, pipeline, caseName);
      const fallbackRows = group.filter(
        (row) => isRecord(row.requests) && row.requests.fallbackUsed === true,
      );
      const returned = fallbackRows.filter(
        (row) => isRecord(row.outcome) && row.outcome.summaryReturned === true,
      ).length;
      const paths = fallbackRows
        .map((row) =>
          isRecord(row.phases) && isRecord(row.phases.status) ? row.phases.status.path : undefined,
        )
        .filter((path): path is string => path !== undefined);
      lines.push(
        `| ${caseName} | ${pipeline} | ${fallbackRows.length} / ${group.length} | ${returned} | ${[...new Set(paths)].join(", ") || "none"} |`,
      );
    }
  return lines.join("\n");
}

function routeMarkdown(counts: RunCountSummary): string {
  const lines = [
    "## Routes and errors",
    "",
    "No request retry loop was enabled. Gateway provider failover is reported as a separate route.",
    "",
    "### Routes",
    "",
    "| route | requests |",
    "| --- | ---: |",
  ];
  for (const [route, count] of Object.entries(counts.routes).sort())
    lines.push(`| ${route} | ${count} |`);
  lines.push("", "### Sanitized errors", "", "| error class | count |", "| --- | ---: |");
  if (Object.keys(counts.errors).length === 0) lines.push("| none | 0 |");
  else
    for (const [error, count] of Object.entries(counts.errors).sort())
      lines.push(`| ${error} | ${count} |`);
  return lines.join("\n");
}

export function resultsMarkdown(report: JsonRecord, fixtures: readonly FixtureCase[]): string {
  const rows = arrayValue(report.runs).filter(isRecord);
  const counts = summarizeRunCounts(rows);
  const authorization = isRecord(report.authorization) ? report.authorization : {};
  const repeats = numberValue(authorization.repeats) ?? 1;
  const totalRuns =
    numberValue(authorization.totalRunsIncludingPrior) ?? rows.length + PRIOR_CENSORED_RUNS;
  const fallbackRequests = counts.lunaFallbacks;
  const missingFallbackSummaries = rows.filter(
    (row) =>
      isRecord(row.requests) &&
      row.requests.fallbackUsed === true &&
      isRecord(row.outcome) &&
      row.outcome.summaryReturned !== true,
  ).length;
  return [
    "# Fast Jev compaction live benchmark",
    "",
    `This report covers ${rows.length} additional live runs: ${repeats} repeat(s) × two pipelines × three synthetic cases. Total sample including the retained censored pass: ${totalRuns} of 24. Runs were sequential and had no retries.`,
    "",
    "## Pilot caveat",
    "",
    "The pilot routed ours through Vercel then OpenRouter while upstream used Vercel directly. It remains a protocol and behavior baseline, not a performance verdict.",
    "",
    groupedMarkdown(rows, fixtures, repeats),
    "",
    fallbackMarkdown(rows),
    "",
    routeMarkdown(counts),
    "",
    "## Measurement limits",
    "",
    "- Context counts use the same `estimateTokens` heuristic for baseline and final text. They are estimates, not provider tokenizer or billing counts.",
    "- Required durable facts are checked by exact marker presence. The routine marker is disposable and is never a required fact.",
    "- The shared fallback uses `summarizePreparedWithModel` with the same model, reserve, reasoning, cache, and `maxRetries: 0` options. Input shape is old messages plus the prior summary argument; any difference between native pipelines is disclosed in the JSON.",
    "- The upstream 25% no-savings gate is benchmark policy, not an upstream algorithm change. Native upstream output is retained when that gate passes.",
    `- ${missingFallbackSummaries} of ${fallbackRequests} fallback requests lacked a usable summary at the ${LUNA_TIMEOUT_MS / 1000}-second Luna cap. Failed compactions use the unchanged baseline, zero savings, and unscored retention.`,
    "- The fallback adapter is a common benchmark adapter, not a claim that either pipeline's host-native fallback path was benchmarked.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const upstreamHead = await gitHead(args.upstreamDir);
  if (upstreamHead !== PINNED_COMMIT)
    throw new Error(`upstream clone is not pinned to ${PINNED_COMMIT}`);
  const beforeStatus = await gitStatus();
  const fixtureRoot = await mkdtemp(join(tmpdir(), "fast-jev-fixtures-"));
  const fixtures = makeFixtures();
  const rows: JsonRecord[] = [];
  let orderIndex = 0;
  try {
    for (const fixture of fixtures)
      await writeFile(join(fixtureRoot, `${fixture.name}.json`), JSON.stringify(fixture));
    for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
      const pipelineOrder = pipelineOrderForRepeat(repeat);
      for (const fixture of fixtures) {
        const fixturePath = join(fixtureRoot, `${fixture.name}.json`);
        for (const pipeline of pipelineOrder) {
          orderIndex += 1;
          const outputPath = join(fixtureRoot, `${repeat}-${fixture.name}-${pipeline}.json`);
          const processResult = await runChild(
            pipeline,
            fixturePath,
            fixture,
            args.upstreamDir,
            outputPath,
            repeat,
          );
          const row = await readRunOutput(outputPath, processResult, pipeline, fixture, repeat);
          rows.push({ ...row, orderIndex });
        }
      }
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
  const afterStatus = await gitStatus();
  const report: JsonRecord = {
    schemaVersion: 3,
    benchmark: "fast-jev-compaction-live-corrected",
    evidenceStatus: "latest-corrected-timeout",
    scope: `${rows.length} additional sequential live compactions: ${args.repeats} repeat(s), two pipelines, three synthetic cases`,
    authorization: {
      paidLiveCalls: true,
      maxCompactionRuns: 24,
      pilotRuns: PILOT_RUNS,
      priorCensoredRuns: PRIOR_CENSORED_RUNS,
      priorCensoredEvidence: join(dirname(args.output), "results-prior-5s-censored.json"),
      maxAdditionalRuns: MAX_ADDITIONAL_RUNS,
      additionalRunsAuthorized: rows.length,
      repeats: args.repeats,
      runsExecuted: rows.length,
      totalRunsIncludingPrior: rows.length + PRIOR_CENSORED_RUNS,
      privateTranscripts: false,
      retries: 0,
    },
    cases: fixtures.map((fixture) => ({
      name: fixture.name,
      description: fixture.description,
      requiredMarkers: fixture.requiredMarkers,
      disposableMarkers: fixture.disposableMarkers,
      routineDroppableMarkers: fixture.routineDroppableMarkers,
    })),
    ordering: {
      sequential: true,
      repeats: args.repeats,
      pipelineOrderByRepeat: Object.fromEntries(
        Array.from({ length: args.repeats }, (_, index) => [
          String(index + 1),
          pipelineOrderForRepeat(index + 1),
        ]),
      ),
      orderIndex: "one-based execution order",
    },
    upstream: {
      repository: "https://github.com/tamaratran/fast-jev-compaction",
      commit: PINNED_COMMIT,
    },
    runtime: {
      pi: "0.87.0 expected from executable",
      requestTimeoutsMs: {
        jev: JEV_TIMEOUT_MS,
        luna: LUNA_TIMEOUT_MS,
        child: CHILD_TIMEOUT_MS,
        totalBudget: TOTAL_BUDGET_MS,
      },
      noInterRunConcurrency: true,
    },
    estimator: {
      name: "upstream state.ts estimateTokens",
      formula: "letters≈1+floor((n-1)/6), digits=n/2, symbols=0.9, ceil",
      billingEquivalent: false,
      baselineAndFinal:
        "same full-context renderer; previous summary, old messages, and tail included exactly once",
    },
    fairness: {
      sameSyntheticCasePerComparison: true,
      sameGatewayAndAuth: true,
      sharedSummaryFunction: "summarizePreparedWithModel",
      sharedSummaryOptions: {
        model: PI_MODEL,
        reserveTokens: RESERVE_TOKENS,
        reasoningEffort: "low",
        cacheRetention: "none",
        maxRetries: 0,
        customInstructions: "none",
      },
      oursFallback:
        "fast-Jev checkpoint path invokes shared regular Luna summary on no eligible candidates, Jev failure, or insufficient savings",
      upstreamFallback:
        "benchmark invokes the same external summary only on native failure or the explicit 25% no-savings gate",
      upstreamReductionGate: UPSTREAM_REDUCTION_GATE,
      upstreamNativeOutputPreservedWhenGatePasses: true,
      fallbackAdapter:
        "Both pipelines use the common summarizePreparedWithModel adapter. The upstream 25% gate is benchmark policy, not a claim about the host-native fallback path.",
    },
    sideEffects: {
      trackedStatusUnchanged: beforeStatus === afterStatus,
      scopedStatusBefore: beforeStatus,
      scopedStatusAfter: afterStatus,
    },
    counts: summarizeRunCounts(rows),
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
      runs: rows.map((row) => ({
        orderIndex: row.orderIndex,
        repeat: row.repeat,
        case: row.case,
        pipeline: row.pipeline,
        ok: row.ok,
        runner: row.runner,
        jevHttp: isRecord(row.requests) ? row.requests.jevHttp : undefined,
        luna: isRecord(row.requests) ? row.requests.luna : undefined,
        totalMs: isRecord(row.phases) ? row.phases.compactorMs : undefined,
      })),
    }),
  );
}

if (import.meta.main) await main();
