import { type AssistantMessage, type Usage, uuidv7 } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type SessionBeforeCompactEvent,
  SettingsManager,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { type JevGatewayFetch, requestJevGateway } from "../../lib/jev-gateway";

const SETTINGS_KEY = "compaction";
const REQUEST_TIMEOUT_MS = 2_400;
const MAX_JEV_DURATION_MS = 12_000;
const DEFAULT_SUMMARY_MODEL = "openai-codex/gpt-6-luna-fast";
const KEEP_THRESHOLD = 0.7;
const MAX_STATE_MESSAGES = 96;
const MAX_STATE_CHARS = 24_000;
const MAX_STATE_TEXT_CHARS = 320;
const MAX_STATE_INPUT_CHARS = 240;
const MAX_ELIGIBLE_CALLS = 256;
const MAX_PARALLEL_BATCHES = 2;
// Match jev-use's ~29 judgments per request: each tool call contributes two judgments.
const CALLS_PER_BATCH = 14;
const MAX_DETAILS_MESSAGES = 96;
const MAX_DETAILS_TEXT_CHARS = 1_200;
const MAX_DETAILS_RESULT_CHARS = 800;
const MAX_FILE_PATHS = 64;
const MAX_CONTINUITY_REQUEST_CHARS = 600;
const MAX_CONTINUITY_FILE_PATHS = 12;
const MAX_CONTINUITY_PATH_CHARS = 180;
const TRUNCATED_RESULT_HEAD_CHARS = 240;
// Pi wraps every persisted compaction summary before sending it back to the model.
const COMPACTION_SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";
const DETAILS_KEY = "fastJev";
const DETAILS_VERSION = 2;
const LEGACY_DETAILS_VERSION = 1;

export const FAST_JEV_STATUS_EVENT = "fast_jev_compaction_status";

interface ToolCall {
  readonly id: string;
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly messageIndex: number;
  readonly resultIndex: number;
  readonly resultChars: number;
  readonly isError: boolean;
}

interface ToolResult {
  readonly toolUseId: string;
  readonly text: string;
  readonly isError: boolean;
}

export interface FastJevMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: readonly {
    readonly toolUseId: string;
    readonly name: string;
    readonly input: Record<string, unknown>;
  }[];
  readonly toolResults: readonly ToolResult[];
}

type Action = "keep" | "drop_result" | "drop_call";

interface Decision {
  readonly id: string;
  readonly tool: string;
  readonly keepCall: number;
  readonly keepResult: number;
  readonly action: Action;
}

interface InferenceState {
  readonly context: string;
  readonly goal: string;
  readonly history: readonly Record<string, unknown>[];
}

export type FastJevFailureReason =
  | "cancelled"
  | "no-eligible-candidates"
  | "jev-failed"
  | "malformed-jev"
  | "jev-timeout"
  | "eligible-call-limit"
  | "insufficient-savings"
  | "summary-model-missing"
  | "summary-runtime-unsupported"
  | "summary-auth-provider-failed"
  | "summary-malformed-output"
  | "summary-empty-output"
  | "summary-truncated-output"
  | "final-size-limit"
  | "unexpected";

export type FastJevExceptionType =
  | "AbortError"
  | "TimeoutError"
  | "ModelsError"
  | "PiMessagesResponseError"
  | "CodexApiError"
  | "CodexProtocolError"
  | "WebSocketCloseError"
  | "AggregateError"
  | "TypeError"
  | "RangeError"
  | "ReferenceError"
  | "SyntaxError"
  | "URIError"
  | "EvalError"
  | "Error"
  | "other";

export interface FastJevDiagnostics {
  readonly exceptionType?: FastJevExceptionType;
  readonly httpStatus?: number;
  readonly providerCode?: string;
}

export interface FastJevAttemptStatus {
  readonly version: 1;
  readonly outcome: "pruned" | "checkpointed" | "fallback";
  readonly path: "prune" | "checkpoint" | "native";
  readonly reason?: FastJevFailureReason;
  readonly checkpointReason?: FastJevFailureReason;
  readonly diagnostics?: FastJevDiagnostics;
  readonly jevMs: number;
  readonly summaryMs: number;
  readonly totalMs: number;
  readonly beforeChars: number;
  readonly afterChars: number;
  readonly calls: number;
}

interface CompactionDetails {
  readonly version: number;
  readonly messages: readonly FastJevMessage[];
  readonly reductionRatio: number;
  readonly calls: number;
  readonly droppedResults: number;
  readonly droppedCalls: number;
  readonly attempt: FastJevAttemptStatus;
}

interface PreviousState {
  readonly messages?: FastJevMessage[];
  readonly summary?: string;
}

export interface FastJevCompactionConfig {
  readonly enabled: boolean;
  readonly summaryModel: string;
}

export function resolveFastJevCompactionConfig(globalSettings: unknown): FastJevCompactionConfig {
  const disabled = { enabled: false, summaryModel: DEFAULT_SUMMARY_MODEL };
  if (!isRecord(globalSettings) || !isRecord(globalSettings.jev)) return disabled;
  const raw = globalSettings.jev[SETTINGS_KEY];
  if (!isRecord(raw) || typeof raw.enabled !== "boolean") return disabled;
  return {
    enabled: raw.enabled,
    summaryModel:
      typeof raw.summaryModel === "string" && raw.summaryModel.trim().length > 0
        ? raw.summaryModel.trim()
        : DEFAULT_SUMMARY_MODEL,
  };
}

function readGlobalConfig(): FastJevCompactionConfig {
  try {
    const settings = SettingsManager.create(process.cwd(), getAgentDir(), {
      projectTrusted: false,
    });
    return resolveFastJevCompactionConfig(settings.getGlobalSettings());
  } catch {
    return { enabled: false, summaryModel: DEFAULT_SUMMARY_MODEL };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KNOWN_EXCEPTION_TYPES = new Set<FastJevExceptionType>([
  "AbortError",
  "TimeoutError",
  "ModelsError",
  "PiMessagesResponseError",
  "CodexApiError",
  "CodexProtocolError",
  "WebSocketCloseError",
  "AggregateError",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "Error",
]);

// Provider SDKs expose a small, recurring set of stable codes. Everything else
// is intentionally collapsed so provider payloads cannot become diagnostics.
const KNOWN_PROVIDER_CODES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "request_too_large",
  "rate_limit_error",
  "api_error",
  "overloaded_error",
  "rate_limit_exceeded",
  "insufficient_quota",
  "invalid_api_key",
  "permission_denied",
  "model_not_found",
  "context_length_exceeded",
  "server_error",
  "service_unavailable",
  "content_policy_violation",
  "previous_response_not_found",
  "websocket_connection_limit_reached",
  "usage_limit_reached",
  "usage_not_included",
  "invalid_request",
  "rate_limit",
  "timeout",
  "overloaded",
  "internal_error",
  "not_found",
  "unauthorized",
  "forbidden",
  "bad_request",
  "too_many_requests",
  "internal_server_error",
  "resource_exhausted",
  "deadline_exceeded",
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "DEADLINE_EXCEEDED",
]);
const DIAGNOSTIC_CHILD_KEYS = [
  "cause",
  "response",
  "payload",
  "details",
  "diagnosticDetails",
  "$metadata",
  "error",
  "diagnostics",
] as const;
const MAX_DIAGNOSTIC_DEPTH = 3;
const MAX_DIAGNOSTIC_NODES = 32;
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 16;
type SafeDiagnosticValue = object | string | number | boolean | null | undefined;

function ownData(value: unknown, key: string): SafeDiagnosticValue {
  if ((typeof value !== "object" && typeof value !== "function") || value === null)
    return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticNodes(value: unknown): unknown[] {
  const nodes: unknown[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length > 0 && nodes.length < MAX_DIAGNOSTIC_NODES) {
    const current = queue.shift();
    if (current === undefined) break;
    const { value: node, depth } = current;
    if ((typeof node !== "object" && typeof node !== "function") || node === null) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
    if (depth >= MAX_DIAGNOSTIC_DEPTH) continue;
    for (const key of DIAGNOSTIC_CHILD_KEYS) {
      const child = ownData(node, key);
      if (Array.isArray(child)) {
        const length = ownData(child, "length");
        const itemCount =
          typeof length === "number" ? Math.min(length, MAX_DIAGNOSTIC_ARRAY_ITEMS) : 0;
        for (let index = 0; index < itemCount; index += 1) {
          const item = ownData(child, String(index));
          if (item !== undefined) queue.push({ value: item, depth: depth + 1 });
        }
      } else if (child !== undefined) {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return nodes;
}

function exceptionType(value: unknown): FastJevExceptionType | undefined {
  const name = ownData(value, "name") ?? ownData(value, "exceptionType");
  if (typeof name === "string") {
    return KNOWN_EXCEPTION_TYPES.has(name as FastJevExceptionType)
      ? (name as FastJevExceptionType)
      : "other";
  }
  try {
    if (value instanceof AggregateError) return "AggregateError";
    if (value instanceof TypeError) return "TypeError";
    if (value instanceof RangeError) return "RangeError";
    if (value instanceof ReferenceError) return "ReferenceError";
    if (value instanceof SyntaxError) return "SyntaxError";
    if (value instanceof URIError) return "URIError";
    if (value instanceof EvalError) return "EvalError";
    if (value instanceof Error) return "Error";
  } catch {
    return undefined;
  }
  return undefined;
}

function diagnosticStatus(value: unknown): number | undefined {
  for (const node of diagnosticNodes(value)) {
    for (const key of ["status", "statusCode", "httpStatusCode"] as const) {
      const candidate = ownData(node, key);
      if (
        typeof candidate === "number" &&
        Number.isInteger(candidate) &&
        candidate >= 100 &&
        candidate <= 599
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

function diagnosticCode(value: unknown): string | undefined {
  let sawUnknown = false;
  for (const node of diagnosticNodes(value)) {
    for (const key of ["code", "errorCode", "providerCode"] as const) {
      const candidate = ownData(node, key);
      if (typeof candidate !== "string" || candidate.length === 0) continue;
      if (KNOWN_PROVIDER_CODES.has(candidate)) return candidate;
      sawUnknown = true;
    }
    // Anthropic and Google put their stable provider code in error.type.
    const providerType = ownData(node, "type");
    if (typeof providerType === "string" && KNOWN_PROVIDER_CODES.has(providerType)) {
      return providerType;
    }
  }
  return sawUnknown ? "other" : undefined;
}

export function sanitizeFastJevDiagnostics(value: unknown): FastJevDiagnostics | undefined {
  const nodes = diagnosticNodes(value);
  const type = nodes.map(exceptionType).find((candidate) => candidate !== undefined);
  const httpStatus = diagnosticStatus(value);
  const providerCode = diagnosticCode(value);
  if (type === undefined && httpStatus === undefined && providerCode === undefined)
    return undefined;
  return {
    ...(type === undefined ? {} : { exceptionType: type }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(providerCode === undefined ? {} : { providerCode }),
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part.type === "image") parts.push("[image]");
  }
  return parts.join("\n");
}

function redact(value: string, limit: number): string {
  const withoutControls = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");

  return withoutControls
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(
      /(["']?)(api[_-]?key|token|secret|password)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1$2$1=[redacted]",
    )
    .replace(/(?:~|\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)[^\s"'`,}]*/gu, "[redacted-path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function safeJson(value: unknown, limit: number): string {
  try {
    return redact(JSON.stringify(value) ?? "", limit);
  } catch {
    return "[unserializable]";
  }
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return { ...value };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? { ...parsed } : { value };
    } catch {
      return { value };
    }
  }
  return {};
}

function readToolCall(
  part: Record<string, unknown>,
): FastJevMessage["toolCalls"][number] | undefined {
  if (part.type !== "toolCall" || typeof part.id !== "string" || typeof part.name !== "string") {
    return undefined;
  }
  return {
    toolUseId: part.id,
    name: part.name,
    input: inputRecord(part.arguments),
  };
}

function sourceMessageText(raw: Record<string, unknown>): string {
  if (raw.role === "bashExecution") {
    const command = typeof raw.command === "string" ? raw.command : "";
    const output = typeof raw.output === "string" ? raw.output : "";
    const exitCode = typeof raw.exitCode === "number" ? `\n[bash exit code]\n${raw.exitCode}` : "";
    const cancelled = raw.cancelled === true ? "\n[bash cancelled]" : "";
    const truncated =
      raw.truncated === true && typeof raw.fullOutputPath === "string"
        ? `\n[bash full output]\n${raw.fullOutputPath}`
        : "";
    return `[bash command]\n${command}\n[bash output]\n${output}${exitCode}${cancelled}${truncated}`;
  }
  if (raw.role === "branchSummary" || raw.role === "compactionSummary") {
    const summary = typeof raw.summary === "string" ? raw.summary : "";
    const fromId = typeof raw.fromId === "string" ? `\n[branch from]\n${raw.fromId}` : "";
    const tokensBefore =
      typeof raw.tokensBefore === "number" ? `\n[tokens before]\n${raw.tokensBefore}` : "";
    return `[${raw.role}]\n${summary}${fromId}${tokensBefore}`;
  }
  if (raw.role === "custom" || raw.role === "custom_message") {
    return `[${raw.role}]\n${contentText(raw.content)}`;
  }
  return raw.role === "toolResult" ? "" : contentText(raw.content);
}

/** Converts Pi messages into private copies; the source transcript is never edited. */
export function toFastJevMessages(messages: readonly unknown[]): FastJevMessage[] {
  const result: FastJevMessage[] = [];
  for (const raw of messages) {
    if (!isRecord(raw) || raw.excludeFromContext === true) continue;
    const role = raw.role === "assistant" ? "assistant" : "user";
    const calls: Array<FastJevMessage["toolCalls"][number]> = [];
    if (Array.isArray(raw.content)) {
      for (const part of raw.content) {
        if (isRecord(part)) {
          const call = readToolCall(part);
          if (call !== undefined) calls.push(call);
        }
      }
    }

    const toolResults: ToolResult[] = [];
    if (raw.role === "toolResult" && typeof raw.toolCallId === "string") {
      toolResults.push({
        toolUseId: raw.toolCallId,
        text: contentText(raw.content),
        isError: raw.isError === true,
      });
    }

    result.push({
      role,
      text: sourceMessageText(raw),
      toolCalls: calls,
      toolResults,
    });
  }
  return result;
}

function validStoredMessage(value: unknown): value is FastJevMessage {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) return false;
  if (typeof value.text !== "string" || !Array.isArray(value.toolCalls)) return false;
  if (!Array.isArray(value.toolResults)) return false;
  return (
    value.toolCalls.every(
      (call) =>
        isRecord(call) &&
        typeof call.toolUseId === "string" &&
        typeof call.name === "string" &&
        isRecord(call.input),
    ) &&
    value.toolResults.every(
      (result) =>
        isRecord(result) &&
        typeof result.toolUseId === "string" &&
        typeof result.text === "string" &&
        typeof result.isError === "boolean",
    )
  );
}

function previousState(
  branchEntries: readonly unknown[],
  previousSummary: string | undefined,
): PreviousState {
  const summary = previousSummary?.trim();
  if (summary) return { summary };

  for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
    const entry = branchEntries[index];
    if (!isRecord(entry) || entry.type !== "compaction") continue;
    const entrySummary = typeof entry.summary === "string" ? entry.summary.trim() : undefined;
    const details = entry.details;
    if (!isRecord(details)) return entrySummary ? { summary: entrySummary } : {};
    const stored = details[DETAILS_KEY];
    if (!isRecord(stored)) return entrySummary ? { summary: entrySummary } : {};
    const version = stored.version;
    if (
      (version !== DETAILS_VERSION && version !== LEGACY_DETAILS_VERSION) ||
      !Array.isArray(stored.messages)
    )
      return entrySummary ? { summary: entrySummary } : {};
    const messages = stored.messages.filter(validStoredMessage).map(copyMessage);
    return {
      ...(entrySummary ? { summary: entrySummary } : {}),
      ...(messages.length > 0 ? { messages } : {}),
    };
  }
  return {};
}

function copyMessage(message: FastJevMessage): FastJevMessage {
  return {
    role: message.role,
    text: message.text,
    toolCalls: message.toolCalls.map((call) => ({
      toolUseId: call.toolUseId,
      name: call.name,
      input: { ...call.input },
    })),
    toolResults: message.toolResults.map((result) => ({ ...result })),
  };
}

function resultMap(
  messages: readonly FastJevMessage[],
): Map<string, { index: number; result: ToolResult }> {
  const results = new Map<string, { index: number; result: ToolResult }>();
  messages.forEach((message, index) => {
    for (const result of message.toolResults) results.set(result.toolUseId, { index, result });
  });
  return results;
}

function collectCalls(messages: readonly FastJevMessage[]): ToolCall[] {
  const results = resultMap(messages);
  const calls: ToolCall[] = [];
  messages.forEach((message, messageIndex) => {
    for (const call of message.toolCalls) {
      const result = results.get(call.toolUseId);
      if (result === undefined) continue;
      calls.push({
        id: `t${calls.length + 1}`,
        toolUseId: call.toolUseId,
        name: call.name,
        input: { ...call.input },
        messageIndex,
        resultIndex: result.index,
        resultChars: result.result.text.length,
        isError: result.result.isError,
      });
    }
  });
  return calls;
}

function stateHistory(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  focusedMessageIndexes?: ReadonlySet<number>,
): Record<string, unknown>[] {
  const callsByMessage = new Map<number, ToolCall[]>();
  for (const call of calls) {
    const list = callsByMessage.get(call.messageIndex) ?? [];
    list.push(call);
    callsByMessage.set(call.messageIndex, list);
  }

  const indexes =
    focusedMessageIndexes === undefined
      ? messages.map((_, index) => index).slice(0, MAX_STATE_MESSAGES)
      : [...focusedMessageIndexes].sort((left, right) => left - right).slice(0, MAX_STATE_MESSAGES);
  const history: Record<string, unknown>[] = [];
  let chars = 0;
  for (const index of indexes) {
    const message = messages[index];
    if (message === undefined) continue;
    const callsForMessage = callsByMessage.get(index) ?? [];
    const entry: Record<string, unknown> = {
      role: message.role,
      text: redact(message.text, MAX_STATE_TEXT_CHARS),
    };
    if (callsForMessage.length > 0) {
      entry.tool_calls = callsForMessage.map((call) => ({
        id: call.id,
        tool: redact(call.name, 80),
        input: redact(safeJson(call.input, MAX_STATE_INPUT_CHARS), MAX_STATE_INPUT_CHARS),
        // Deliberately metadata only: Jev never receives a tool-result body.
        result: { chars: call.resultChars, error: call.isError },
      }));
    }
    if (
      focusedMessageIndexes === undefined &&
      message.toolResults.length > 0 &&
      callsForMessage.length === 0
    ) {
      entry.tool_results = message.toolResults.map((result) => ({
        id: result.toolUseId,
        chars: result.text.length,
        error: result.isError,
      }));
    }

    const nextChars = chars + safeJson(entry, MAX_STATE_CHARS).length;
    if (nextChars > MAX_STATE_CHARS && history.length > 0) break;
    history.push(entry);
    chars = nextChars;
  }
  return history;
}

function createInferenceState(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  customInstructions: string | undefined,
  focusedMessageIndexes?: ReadonlySet<number>,
): InferenceState {
  const users = messages
    .filter((message) => message.role === "user" && message.text.trim().length > 0)
    .slice(-3)
    .map((message) => redact(message.text, 500));
  const goal = [
    ...users,
    ...(customInstructions?.trim() ? [redact(customInstructions, 500)] : []),
  ].join("\n");
  return {
    context:
      focusedMessageIndexes === undefined
        ? "A coding-assistant transcript is being compacted. Decide whether each tool call and its full result still need to remain. Tool-result bodies are intentionally omitted from this state."
        : "A focused coding-assistant transcript is being compacted. The history contains this batch's calls and their nearest preceding user messages. Tool-result bodies are intentionally omitted from this state.",
    goal,
    history: stateHistory(messages, calls, focusedMessageIndexes),
  };
}

export function buildInferenceState(
  messages: readonly FastJevMessage[],
  customInstructions?: string,
): InferenceState {
  return createInferenceState(messages, collectCalls(messages), customInstructions);
}

function buildBatchInferenceState(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  customInstructions: string | undefined,
): InferenceState {
  const focusedMessageIndexes = new Set<number>();
  for (const call of calls) {
    focusedMessageIndexes.add(call.messageIndex);
    for (let index = call.messageIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "user" && message.text.trim().length > 0) {
        focusedMessageIndexes.add(index);
        break;
      }
    }
  }
  return createInferenceState(messages, calls, customInstructions, focusedMessageIndexes);
}

function questionFor(call: ToolCall, kind: "call" | "result"): Record<string, unknown> {
  const id = `${kind}_${call.id}`;
  if (kind === "call") {
    return {
      [id]: {
        type: "noul",
        instructions: `The ${call.name} tool call and its exact input still matter for continuing the task; keeping the call is safer than re-running it or losing its path, command, or identifier.`,
        criteria: {
          true: "The call records important task-specific facts or an action that must remain visible.",
          false: "The call is routine, stale, or safely reproducible.",
        },
      },
    };
  }
  return {
    [id]: {
      type: "noul",
      instructions: `The full ${call.name} tool result still matters verbatim for continuing the task; keep it only when its contents cannot be cheaply recreated.`,
      criteria: {
        true: "The result contains unique facts or evidence that later work needs.",
        false: "The result is stale, routine, or safely reproducible by re-running the tool.",
      },
    },
  };
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseNoulAnswers(
  value: unknown,
  names: readonly string[],
): Record<string, number> | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const answers = value.answers;
  const expected = new Set(names);
  const keys = Object.keys(answers);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) return undefined;

  const parsed: Record<string, number> = {};
  for (const name of names) {
    const answer = answers[name];
    if (!isRecord(answer) || answer.type !== "noul" || !isUnit(answer.noul)) return undefined;
    parsed[name] = answer.noul;
  }
  return parsed;
}

function actionFor(keepCall: number, keepResult: number): Action {
  // Equality keeps content so threshold-bound decisions fail toward retention.
  if (keepResult >= KEEP_THRESHOLD) return "keep";
  if (keepCall >= KEEP_THRESHOLD) return "drop_result";
  return "drop_call";
}

function truncateResult(text: string, isError: boolean): string {
  if (text.length <= TRUNCATED_RESULT_HEAD_CHARS + 100) return text;
  const suffix = `[fast-jev-compaction truncated ${text.length - TRUNCATED_RESULT_HEAD_CHARS} chars${isError ? " (error)" : ""}; re-run the tool if needed]`;
  return `${text.slice(0, TRUNCATED_RESULT_HEAD_CHARS)}\n${suffix}`;
}

function applyDecisions(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  decisions: readonly Decision[],
): FastJevMessage[] {
  const actions = new Map<string, Action>();
  const byId = new Map(calls.map((call) => [call.id, call]));
  for (const decision of decisions) {
    const call = byId.get(decision.id);
    if (call !== undefined && decision.action !== "keep")
      actions.set(call.toolUseId, decision.action);
  }

  return messages.flatMap((message) => {
    const nextCalls = message.toolCalls
      .filter((call) => actions.get(call.toolUseId) !== "drop_call")
      .map((call) => ({ ...call, input: { ...call.input } }));
    const nextResults = message.toolResults
      .filter((result) => actions.get(result.toolUseId) !== "drop_call")
      .map((result) => {
        if (actions.get(result.toolUseId) !== "drop_result") return { ...result };
        return { ...result, text: truncateResult(result.text, result.isError) };
      });
    if (message.text.trim().length === 0 && nextCalls.length === 0 && nextResults.length === 0) {
      return [];
    }
    return [
      {
        role: message.role,
        text: message.text,
        toolCalls: nextCalls,
        toolResults: nextResults,
      },
    ];
  });
}

function renderDroppedMaterial(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  decisions: readonly Decision[],
): string {
  const actions = new Map(decisions.map((decision) => [decision.id, decision.action]));
  const sections: string[] = [];
  for (const call of calls) {
    const action = actions.get(call.id);
    if (action === undefined || action === "keep") continue;
    if (action !== "drop_call") continue;
    sections.push(`[removed tool call ${call.name}] ${transcriptJson(call.input)}`);
    const result = messages[call.resultIndex]?.toolResults.find(
      (candidate) => candidate.toolUseId === call.toolUseId,
    );
    if (result !== undefined) {
      sections.push(
        `[removed tool result ${call.toolUseId}${result.isError ? " · error" : ""}]\n${truncateResult(result.text, result.isError)}`,
      );
    }
  }
  return sections.join("\n\n");
}

function messageChars(message: FastJevMessage): number {
  let chars = message.text.length;
  for (const call of message.toolCalls)
    chars += safeJson(call.input, Number.MAX_SAFE_INTEGER).length;
  for (const result of message.toolResults) chars += result.text.length;
  return chars;
}

function transcriptJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}

function renderTranscript(messages: readonly FastJevMessage[], droppedSummary: string): string {
  const lines = [
    "<fast-jev-compaction>",
    "Removed tool material is represented by explicit excerpts; retained transcript content follows.",
  ];
  if (droppedSummary.length > 0) {
    lines.push(`\n<removed-material-summary>\n${droppedSummary}\n</removed-material-summary>`);
  }
  let index = 0;
  for (const message of messages) {
    index += 1;
    if (message.text.length > 0) lines.push(`\n--- ${message.role} ${index} ---\n${message.text}`);
    for (const call of message.toolCalls) {
      lines.push(`\n[tool call ${call.name}] ${transcriptJson(call.input)}`);
    }
    for (const result of message.toolResults) {
      lines.push(
        `\n[tool result ${result.toolUseId}${result.isError ? " · error" : ""}]\n${result.text}`,
      );
    }
  }
  lines.push("\n</fast-jev-compaction>");
  return lines.join("");
}

interface RenderedPruning {
  readonly decisions: Decision[];
  readonly messages: FastJevMessage[];
  readonly summary: string;
  readonly afterChars: number;
  readonly reductionRatio: number;
}

function renderPrunedOutput(
  messages: readonly FastJevMessage[],
  calls: readonly ToolCall[],
  decisions: ReadonlyMap<string, Decision>,
  beforeChars: number,
  continuityHeader: string,
): RenderedPruning {
  const allDecisions = calls.map(
    (call) =>
      decisions.get(call.id) ?? {
        id: call.id,
        tool: call.name,
        keepCall: 1,
        keepResult: 1,
        action: "keep" as const,
      },
  );
  const compacted = applyDecisions(messages, calls, allDecisions);
  const droppedMaterial = renderDroppedMaterial(messages, calls, allDecisions);
  const summary = `${continuityHeader}\n\n${renderTranscript(compacted, droppedMaterial)}`;
  const afterChars = compactionSummaryChars(summary);
  return {
    decisions: allDecisions,
    messages: compacted,
    summary,
    afterChars,
    reductionRatio: beforeChars === 0 ? 0 : (beforeChars - afterChars) / beforeChars,
  };
}

function detailsMessages(messages: readonly FastJevMessage[]): FastJevMessage[] {
  return messages.slice(0, MAX_DETAILS_MESSAGES).map((message) => ({
    role: message.role,
    text: message.text.slice(0, MAX_DETAILS_TEXT_CHARS),
    toolCalls: message.toolCalls.map((call) => ({
      toolUseId: call.toolUseId,
      name: call.name.slice(0, 80),
      input: { redacted: safeJson(call.input, MAX_STATE_INPUT_CHARS) },
    })),
    toolResults: message.toolResults.map((result) => ({
      toolUseId: result.toolUseId,
      text: result.text.slice(0, MAX_DETAILS_RESULT_CHARS),
      isError: result.isError,
    })),
  }));
}

function fileList(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  return values
    .filter((path): path is string => typeof path === "string")
    .map((path) => redact(path, 400))
    .filter(Boolean)
    .slice(0, MAX_FILE_PATHS);
}

function fileDetails(preparation: SessionBeforeCompactEvent["preparation"]): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const fileOps = preparation.fileOps as unknown;
  if (!isRecord(fileOps)) return { readFiles: [], modifiedFiles: [] };
  const read = new Set(fileList(fileOps.read));
  const modified = new Set([...fileList(fileOps.written), ...fileList(fileOps.edited)]);
  for (const path of modified) read.delete(path);
  return { readFiles: [...read].sort(), modifiedFiles: [...modified].sort() };
}

interface ContinuityFileList {
  readonly paths: readonly string[];
  readonly omitted: number;
}

function rawFilePaths(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  return [...new Set(values.filter((path): path is string => typeof path === "string"))];
}

function boundedRedactedText(
  value: string,
  limit: number,
): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const redacted = redact(value, limit + 1);
  return {
    text: redacted.slice(0, limit),
    truncated: redacted.length > limit,
  };
}

function continuityFileList(paths: readonly string[]): ContinuityFileList {
  const sorted = [...paths].sort();
  return {
    paths: sorted.slice(0, MAX_CONTINUITY_FILE_PATHS).map((path) => {
      const bounded = boundedRedactedText(path, MAX_CONTINUITY_PATH_CHARS);
      return bounded.truncated ? `${bounded.text}…` : bounded.text;
    }),
    omitted: Math.max(0, sorted.length - MAX_CONTINUITY_FILE_PATHS),
  };
}

function continuityFileDetails(
  preparation: SessionBeforeCompactEvent["preparation"],
): { readonly read: ContinuityFileList; readonly modified: ContinuityFileList } | undefined {
  const fileOps = preparation.fileOps as unknown;
  if (!isRecord(fileOps)) return undefined;
  const read = new Set(rawFilePaths(fileOps.read));
  const modified = new Set([...rawFilePaths(fileOps.written), ...rawFilePaths(fileOps.edited)]);
  for (const path of modified) read.delete(path);
  return {
    read: continuityFileList([...read]),
    modified: continuityFileList([...modified]),
  };
}

function latestUserRequest(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user" || message.excludeFromContext === true)
      continue;
    const text = contentText(message.content).trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

function renderContinuityHeader(
  preparation: SessionBeforeCompactEvent["preparation"],
  preparedMessages: readonly unknown[],
): string {
  const request = latestUserRequest(preparedMessages);
  const requestExcerpt =
    request === undefined
      ? "unavailable (no user text found in the compacted span)"
      : (() => {
          const bounded = boundedRedactedText(request, MAX_CONTINUITY_REQUEST_CHARS);
          return `${bounded.text}${bounded.truncated ? " [excerpt truncated]" : ""}`;
        })();
  const files = continuityFileDetails(preparation);
  const renderFiles = (label: string, list: ContinuityFileList | undefined) => {
    if (list === undefined) return `Pi fileOps ${label} paths: unavailable.`;
    const entries = list.paths.length === 0 ? "none recorded" : list.paths.join(", ");
    return `Pi fileOps ${label} paths (limit ${MAX_CONTINUITY_FILE_PATHS}; ${list.omitted} omitted; each path capped at ${MAX_CONTINUITY_PATH_CHARS} chars): ${entries}`;
  };

  return [
    "<fast-jev-continuity>",
    "Deterministic continuity notes. These bounded excerpts are not exhaustive and do not infer progress, decisions, or next steps.",
    `Latest user request in compacted span (may be superseded by Pi's kept tail; excerpt limit ${MAX_CONTINUITY_REQUEST_CHARS} chars): ${requestExcerpt}`,
    renderFiles("read", files?.read),
    renderFiles("modified", files?.modified),
    "</fast-jev-continuity>",
  ].join("\n");
}

type SummaryOutput = {
  readonly text: string;
  readonly usage?: Usage;
};

type SummaryFailure = {
  readonly failureReason: Extract<
    FastJevFailureReason,
    | "cancelled"
    | "summary-model-missing"
    | "summary-runtime-unsupported"
    | "summary-auth-provider-failed"
    | "summary-malformed-output"
    | "summary-empty-output"
    | "summary-truncated-output"
  >;
  readonly diagnostics?: FastJevDiagnostics;
};

type SummaryAttempt = SummaryOutput | SummaryFailure;

function isSummaryFailure(value: SummaryAttempt | undefined): value is SummaryFailure {
  return value !== undefined && "failureReason" in value;
}

export interface FastJevRunOptions {
  readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "getProviderAuth">;
  readonly summarizeCheckpoint: (
    messages: SessionBeforeCompactEvent["preparation"]["messagesToSummarize"],
    previousSummary: string | undefined,
    customInstructions: string | undefined,
    signal?: AbortSignal,
  ) => Promise<SummaryAttempt | undefined>;
  readonly signal?: AbortSignal;
  readonly fetch?: JevGatewayFetch;
  readonly onStatus?: (status: FastJevAttemptStatus) => void;
}

type FastJevResult = {
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly usage?: SummaryOutput["usage"];
  readonly details: {
    readonly readFiles: string[];
    readonly modifiedFiles: string[];
    readonly [DETAILS_KEY]: CompactionDetails;
  };
};

const SAFE_TO_RECREATE = new Set(["read", "grep", "find", "ls", "glob", "search", "cat", "pwd"]);

function isProtectedCall(call: ToolCall): boolean {
  // Unknown tools, failed results, and actions outside this read-only set remain intact.
  return call.isError || !SAFE_TO_RECREATE.has(call.name.toLowerCase());
}

function monotonicMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function renderedTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compactionSummaryChars(text: string): number {
  return `${COMPACTION_SUMMARY_PREFIX}${text}${COMPACTION_SUMMARY_SUFFIX}`.length;
}

function renderFitsBudget(
  text: string,
  preparation: SessionBeforeCompactEvent["preparation"],
): boolean {
  const reserveTokens = preparation.settings.reserveTokens;
  const wrappedText = `${COMPACTION_SUMMARY_PREFIX}${text}${COMPACTION_SUMMARY_SUFFIX}`;
  return (
    Number.isSafeInteger(reserveTokens) &&
    reserveTokens > 0 &&
    renderedTokens(wrappedText) <= reserveTokens
  );
}

function status(
  outcome: FastJevAttemptStatus["outcome"],
  path: FastJevAttemptStatus["path"],
  reason: FastJevFailureReason | undefined,
  jevMs: number,
  summaryMs: number,
  totalMs: number,
  beforeChars: number,
  afterChars: number,
  calls: number,
  diagnostics?: FastJevDiagnostics,
  checkpointReason?: FastJevFailureReason,
): FastJevAttemptStatus {
  return {
    version: 1,
    outcome,
    path,
    ...(reason === undefined ? {} : { reason }),
    ...(checkpointReason === undefined ? {} : { checkpointReason }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    jevMs,
    summaryMs,
    totalMs,
    beforeChars,
    afterChars,
    calls,
  };
}

function safeFailureReason(reason: FastJevFailureReason): FastJevFailureReason {
  return reason;
}

async function checkpointPrepared(
  preparation: SessionBeforeCompactEvent["preparation"],
  previousSummary: string | undefined,
  preparedMessages: SessionBeforeCompactEvent["preparation"]["messagesToSummarize"],
  branchMessages: readonly FastJevMessage[],
  calls: number,
  options: FastJevRunOptions,
  customInstructions: string | undefined,
  startedAt: number,
  jevMs: number,
  reason: FastJevFailureReason,
): Promise<FastJevResult | undefined> {
  const beforeChars = branchMessages.reduce((sum, message) => sum + messageChars(message), 0);
  if (options.signal?.aborted) {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        "cancelled",
        jevMs,
        0,
        monotonicMs(startedAt),
        beforeChars,
        beforeChars,
        calls,
        undefined,
        reason,
      ),
    );
    return undefined;
  }

  const summaryStartedAt = performance.now();
  let output: SummaryAttempt | undefined;
  try {
    output = await options.summarizeCheckpoint(
      preparedMessages,
      previousSummary,
      customInstructions,
      options.signal,
    );
  } catch (error) {
    const diagnostics = sanitizeFastJevDiagnostics(error);
    output = {
      failureReason: "summary-auth-provider-failed",
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  const summaryMs = monotonicMs(summaryStartedAt);
  if (
    options.signal?.aborted ||
    (isSummaryFailure(output) && output.failureReason === "cancelled")
  ) {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        "cancelled",
        jevMs,
        summaryMs,
        monotonicMs(startedAt),
        beforeChars,
        beforeChars,
        calls,
        undefined,
        reason,
      ),
    );
    return undefined;
  }
  if (isSummaryFailure(output)) {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        output.failureReason,
        jevMs,
        summaryMs,
        monotonicMs(startedAt),
        beforeChars,
        beforeChars,
        calls,
        output.diagnostics,
        reason,
      ),
    );
    return undefined;
  }
  const text = output?.text.trim();
  if (!text) {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        "summary-empty-output",
        jevMs,
        summaryMs,
        monotonicMs(startedAt),
        beforeChars,
        beforeChars,
        calls,
        undefined,
        reason,
      ),
    );
    return undefined;
  }
  if (!renderFitsBudget(text, preparation)) {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        "final-size-limit",
        jevMs,
        summaryMs,
        monotonicMs(startedAt),
        beforeChars,
        compactionSummaryChars(text),
        calls,
        undefined,
        reason,
      ),
    );
    return undefined;
  }

  const attempt = status(
    "checkpointed",
    "checkpoint",
    reason,
    jevMs,
    summaryMs,
    monotonicMs(startedAt),
    beforeChars,
    compactionSummaryChars(text),
    calls,
    undefined,
    reason,
  );
  options.onStatus?.(attempt);
  const details: CompactionDetails = {
    version: DETAILS_VERSION,
    messages: detailsMessages(branchMessages),
    reductionRatio:
      beforeChars === 0 ? 0 : (beforeChars - compactionSummaryChars(text)) / beforeChars,
    calls,
    droppedResults: 0,
    droppedCalls: 0,
    attempt,
  };
  const files = fileDetails(preparation);
  return {
    summary: text,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    usage: output?.usage,
    details: { ...files, [DETAILS_KEY]: details },
  };
}

export async function runFastJevCompaction(
  preparation: SessionBeforeCompactEvent["preparation"],
  branchEntries: readonly unknown[],
  options: FastJevRunOptions,
  customInstructions?: string,
): Promise<FastJevResult | undefined> {
  const startedAt = performance.now();
  // A split-turn prefix precedes firstKeptEntryId and is discarded too; preserve it in compaction.
  const preparedMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  if (options.signal?.aborted) {
    options.onStatus?.(status("fallback", "native", "cancelled", 0, 0, 0, 0, 0, 0));
    return undefined;
  }
  if (preparedMessages.length === 0) return undefined;

  const previous = previousState(branchEntries, preparation.previousSummary);
  // A previous summary is authoritative; legacy detail messages are used only when it is absent.
  const baseMessages = previous.summary
    ? [{ role: "user" as const, text: previous.summary, toolCalls: [], toolResults: [] }]
    : (previous.messages ?? []);
  const spanMessages = toFastJevMessages(preparedMessages);
  const continuityHeader = renderContinuityHeader(preparation, preparedMessages);
  const messages = [...baseMessages.map(copyMessage), ...spanMessages.map(copyMessage)];
  const calls = collectCalls(messages);
  const baseLength = baseMessages.length;
  const eligibleCalls = calls.filter(
    (call) => call.messageIndex >= baseLength && !isProtectedCall(call),
  );
  const candidates = eligibleCalls.slice(0, MAX_ELIGIBLE_CALLS);
  const hitCandidateLimit = eligibleCalls.length > MAX_ELIGIBLE_CALLS;
  const beforeChars = messages.reduce((sum, message) => sum + messageChars(message), 0);
  if (candidates.length === 0) {
    return checkpointPrepared(
      preparation,
      previous.summary,
      preparedMessages,
      messages,
      calls.length,
      options,
      customInstructions,
      startedAt,
      0,
      safeFailureReason("no-eligible-candidates"),
    );
  }

  const jevStartedAt = performance.now();
  const deadline = new AbortController();
  const onCallerAbort = () => deadline.abort();
  if (options.signal?.aborted) deadline.abort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => deadline.abort(), MAX_JEV_DURATION_MS);
  const decisions = new Map<string, Decision>();
  let stoppingReason: FastJevFailureReason | undefined;
  let successfulRender: RenderedPruning | undefined;
  let latestRender: RenderedPruning | undefined;
  const callsPerRound = CALLS_PER_BATCH * MAX_PARALLEL_BATCHES;

  try {
    for (let offset = 0; offset < candidates.length; offset += callsPerRound) {
      if (options.signal?.aborted) {
        stoppingReason = "cancelled";
        break;
      }
      if (deadline.signal.aborted) {
        stoppingReason = "jev-timeout";
        break;
      }
      const remainingMs = MAX_JEV_DURATION_MS - monotonicMs(jevStartedAt);
      if (remainingMs <= 0) {
        stoppingReason = "jev-timeout";
        break;
      }

      const round = candidates.slice(offset, offset + callsPerRound);
      const batches = Array.from(
        { length: Math.ceil(round.length / CALLS_PER_BATCH) },
        (_, index) => round.slice(index * CALLS_PER_BATCH, (index + 1) * CALLS_PER_BATCH),
      );
      const batchResults: Array<{
        readonly answers?: Record<string, number>;
        readonly malformed?: boolean;
        readonly failureReason?: "jev-failed" | "jev-timeout";
      }> = await Promise.all(
        batches.map(async (batch) => {
          const state = buildBatchInferenceState(messages, batch, customInstructions);
          const questions = Object.assign(
            {},
            ...batch.flatMap((call) => [questionFor(call, "call"), questionFor(call, "result")]),
          );
          const names = batch.flatMap((call) => [`call_${call.id}`, `result_${call.id}`]);
          try {
            const gateway = await requestJevGateway(
              options.modelRegistry,
              { state, questions },
              {
                timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
                signal: deadline.signal,
                ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
              },
            );
            if (!gateway.ok) {
              return {
                failureReason: gateway.reason === "timeout" ? "jev-timeout" : "jev-failed",
              };
            }
            const answers = parseNoulAnswers(gateway.value, names);
            return answers === undefined ? { malformed: true } : { answers };
          } catch {
            return {
              failureReason: deadline.signal.aborted ? "jev-timeout" : "jev-failed",
            };
          }
        }),
      );

      if (options.signal?.aborted) {
        stoppingReason = "cancelled";
        break;
      }
      if (deadline.signal.aborted) {
        stoppingReason = "jev-timeout";
        break;
      }
      if (batchResults.some((result) => result.malformed)) {
        stoppingReason = "malformed-jev";
        break;
      }
      const batchFailure = batchResults.find((result) => result.failureReason !== undefined);
      if (batchFailure?.failureReason !== undefined) {
        stoppingReason = batchFailure.failureReason;
        break;
      }

      // Commit a round only after every parallel batch has a complete, validated answer set.
      const roundDecisions: Decision[] = [];
      for (const [batchIndex, batch] of batches.entries()) {
        const answers = batchResults[batchIndex]?.answers;
        if (answers === undefined) {
          stoppingReason = "malformed-jev";
          break;
        }
        for (const call of batch) {
          const keepCall = answers[`call_${call.id}`];
          const keepResult = answers[`result_${call.id}`];
          if (keepCall === undefined || keepResult === undefined) {
            stoppingReason = "malformed-jev";
            break;
          }
          roundDecisions.push({
            id: call.id,
            tool: call.name,
            keepCall,
            keepResult,
            action: actionFor(keepCall, keepResult),
          });
        }
        if (stoppingReason !== undefined) break;
      }
      if (stoppingReason !== undefined) break;
      for (const decision of roundDecisions) decisions.set(decision.id, decision);

      latestRender = renderPrunedOutput(messages, calls, decisions, beforeChars, continuityHeader);
      if (options.signal?.aborted) {
        stoppingReason = "cancelled";
        break;
      }
      if (
        latestRender.afterChars < beforeChars &&
        renderFitsBudget(latestRender.summary, preparation)
      ) {
        successfulRender = latestRender;
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }

  const jevMs = monotonicMs(jevStartedAt);
  if (options.signal?.aborted || stoppingReason === "cancelled") {
    options.onStatus?.(
      status(
        "fallback",
        "native",
        "cancelled",
        jevMs,
        0,
        monotonicMs(startedAt),
        beforeChars,
        beforeChars,
        calls.length,
      ),
    );
    return undefined;
  }
  if (stoppingReason !== undefined) {
    return checkpointPrepared(
      preparation,
      previous.summary,
      preparedMessages,
      messages,
      calls.length,
      options,
      customInstructions,
      startedAt,
      jevMs,
      stoppingReason,
    );
  }
  if (successfulRender === undefined) {
    const reason = hitCandidateLimit
      ? "eligible-call-limit"
      : latestRender === undefined || latestRender.afterChars >= beforeChars
        ? "insufficient-savings"
        : "final-size-limit";
    return checkpointPrepared(
      preparation,
      previous.summary,
      preparedMessages,
      messages,
      calls.length,
      options,
      customInstructions,
      startedAt,
      jevMs,
      reason,
    );
  }

  const allDecisions = successfulRender.decisions;
  const attempt = status(
    "pruned",
    "prune",
    undefined,
    jevMs,
    0,
    monotonicMs(startedAt),
    beforeChars,
    successfulRender.afterChars,
    calls.length,
  );
  options.onStatus?.(attempt);
  const details: CompactionDetails = {
    version: DETAILS_VERSION,
    messages: detailsMessages(successfulRender.messages),
    reductionRatio: successfulRender.reductionRatio,
    calls: calls.length,
    droppedResults: allDecisions.filter((decision) => decision.action === "drop_result").length,
    droppedCalls: allDecisions.filter((decision) => decision.action === "drop_call").length,
    attempt,
  };
  const files = fileDetails(preparation);
  return {
    summary: successfulRender.summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    details: { ...files, [DETAILS_KEY]: details },
  };
}

export function splitSummaryModelReference(
  modelReference: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const separator = modelReference.indexOf("/");
  if (separator <= 0 || separator === modelReference.length - 1) return undefined;
  return {
    provider: modelReference.slice(0, separator),
    modelId: modelReference.slice(separator + 1),
  };
}

export async function summarizePreparedWithModel(
  ctx: ExtensionContext,
  modelReference: string,
  messages: SessionBeforeCompactEvent["preparation"]["messagesToSummarize"],
  previousSummary: string | undefined,
  reserveTokens: number,
  customInstructions: string | undefined,
  signal?: AbortSignal,
): Promise<SummaryAttempt> {
  if (signal?.aborted) return { failureReason: "cancelled" };
  const reference = splitSummaryModelReference(modelReference);
  if (reference === undefined) return { failureReason: "summary-model-missing" };
  if (!Number.isSafeInteger(reserveTokens) || reserveTokens <= 0) {
    return { failureReason: "summary-malformed-output" };
  }

  const registry = ctx.modelRegistry;
  if (typeof registry.complete !== "function") {
    return { failureReason: "summary-runtime-unsupported" };
  }
  const model = registry.find(reference.provider, reference.modelId);
  if (model === undefined) return { failureReason: "summary-model-missing" };
  const instruction = [
    "Write one coherent checkpoint of the prepared old context. Include concrete facts needed later, exact names, paths, commands, errors, and numbers.",
    "Merge the previous summary when provided. Do not mention compaction, do not emit a nested transcript, and do not summarize messages outside the prepared input.",
    ...(customInstructions?.trim() ? [customInstructions.trim()] : []),
  ].join(" ");
  const transcript = serializeConversation(convertToLlm([...messages]));
  const previous = previousSummary?.trim();
  const prompt = [
    previous ? `<previous-summary>\n${previous}\n</previous-summary>` : "",
    "<prepared-context>",
    transcript,
    "</prepared-context>",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (signal?.aborted) return { failureReason: "cancelled" };

  const modelMaxTokens =
    typeof model.maxTokens === "number" && model.maxTokens > 0
      ? model.maxTokens
      : Number.POSITIVE_INFINITY;
  let result: AssistantMessage;
  try {
    result = await registry.complete(
      model,
      {
        systemPrompt: instruction,
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      {
        maxTokens: Math.max(1, Math.min(Math.floor(reserveTokens * 0.8), modelMaxTokens)),
        reasoningEffort: "low",
        cacheRetention: "none",
        sessionId: uuidv7(),
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error) {
    if (signal?.aborted) return { failureReason: "cancelled" };
    const diagnostics = sanitizeFastJevDiagnostics(error);
    return {
      failureReason: "summary-auth-provider-failed",
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  if (signal?.aborted || result.stopReason === "aborted") return { failureReason: "cancelled" };
  if (result.stopReason === "length") return { failureReason: "summary-truncated-output" };
  if (result.stopReason === "error") {
    const diagnostics = sanitizeFastJevDiagnostics(result);
    return {
      failureReason: "summary-auth-provider-failed",
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  if (!Array.isArray(result.content)) return { failureReason: "summary-malformed-output" };
  if (result.content.some((part) => isRecord(part) && part.type === "toolCall")) {
    return { failureReason: "summary-malformed-output" };
  }
  const text = contentText(result.content).trim();
  if (text.length === 0) return { failureReason: "summary-empty-output" };
  return result.usage === undefined ? { text } : { text, usage: result.usage };
}

export default function fastJevCompaction(pi: ExtensionAPI): void {
  let registered = false;
  let lastStatus: FastJevAttemptStatus | undefined;
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("fast-jev-status", {
      description: "Show the last Fast Jev compaction status",
      handler: async (_args, ctx) => {
        if (lastStatus === undefined) {
          ctx.ui.notify("Fast Jev compaction has no recorded attempt.", "info");
          return;
        }
        const reason = lastStatus.reason === undefined ? "" : ` (${lastStatus.reason})`;
        const checkpoint =
          lastStatus.checkpointReason === undefined
            ? ""
            : `; checkpoint triggered by ${lastStatus.checkpointReason}${lastStatus.outcome === "fallback" && lastStatus.reason !== undefined ? `; summary failed: ${lastStatus.reason}` : ""}`;
        const diagnostics = lastStatus.diagnostics;
        const diagnosticParts = [
          diagnostics?.exceptionType,
          diagnostics?.httpStatus === undefined ? undefined : `HTTP ${diagnostics.httpStatus}`,
          diagnostics?.providerCode === undefined ? undefined : `code ${diagnostics.providerCode}`,
        ].filter((part): part is string => part !== undefined);
        const diagnosticText =
          diagnosticParts.length === 0 ? "" : `; diagnostics: ${diagnosticParts.join(", ")}`;
        const type = lastStatus.outcome === "fallback" ? "warning" : "info";
        const outcome =
          lastStatus.outcome === "fallback"
            ? "native fallback (Fast Jev compaction not finished)"
            : lastStatus.outcome;
        ctx.ui.notify(
          `Fast Jev ${outcome}${reason}${checkpoint}: ${lastStatus.beforeChars}→${lastStatus.afterChars} chars; ${lastStatus.totalMs} ms total (Jev ${lastStatus.jevMs} ms, summary ${lastStatus.summaryMs} ms); ${lastStatus.calls} calls; path ${lastStatus.path}${diagnosticText}.`,
          type,
        );
      },
    });
  }
  pi.on("session_start", () => {
    if (registered) return;
    registered = true;
    const config = readGlobalConfig();
    // Register after startup; returning undefined delegates to Pi's native compactor.
    // SAFETY: ExtensionAPI.on has the runtime compaction overload; a global startup declaration appends an incompatible final overload.
    const onBeforeCompact = pi.on as unknown as (
      event: "session_before_compact",
      handler: (
        event: SessionBeforeCompactEvent,
        ctx: ExtensionContext,
      ) => Promise<unknown> | unknown,
    ) => void;
    onBeforeCompact("session_before_compact", async (event, ctx) => {
      if (!config.enabled) return undefined;
      if (event.reason === "manual" && event.customInstructions?.trim()) return undefined;

      try {
        const result = await runFastJevCompaction(
          event.preparation,
          event.branchEntries,
          {
            summarizeCheckpoint: (messages, previousSummary, instructions, signal) =>
              summarizePreparedWithModel(
                ctx,
                config.summaryModel,
                messages,
                previousSummary,
                event.preparation.settings.reserveTokens,
                instructions,
                signal,
              ),
            modelRegistry: ctx.modelRegistry,
            signal: event.signal,
            onStatus: (attempt) => {
              lastStatus = attempt;
              pi.events.emit(FAST_JEV_STATUS_EVENT, attempt);
            },
          },
          event.customInstructions,
        );
        if (result === undefined) return undefined;
        return {
          compaction: {
            ...result,
            ...(result.usage === undefined ? {} : { usage: result.usage }),
          },
        };
      } catch (error) {
        const diagnostics = sanitizeFastJevDiagnostics(error);
        const attempt = status("fallback", "native", "unexpected", 0, 0, 0, 0, 0, 0, diagnostics);
        lastStatus = attempt;
        pi.events.emit(FAST_JEV_STATUS_EVENT, attempt);
        return undefined;
      }
    });
  });
}
