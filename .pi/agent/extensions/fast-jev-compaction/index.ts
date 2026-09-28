import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type SessionBeforeCompactEvent,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type JevGatewayFailure,
  type JevGatewayFetch,
  requestJevGateway,
} from "../../lib/jev-gateway";
import {
  type PhasedCandidate,
  type PhasedPhase,
  type PhasedSelectionDiagnostic,
  type PhasedSelectionResult,
  type PhasedSourceSpan,
  runPhasedSelection,
} from "./phased";

const SETTINGS_KEY = "compaction";
const REQUEST_TIMEOUT_MS = 2_400;
const MAX_JEV_DURATION_MS = 12_000;
const KEEP_THRESHOLD = 0.7;
const MAX_SOURCE_SPANS = 1_024;
const MAX_SOURCE_SPAN_CHARS = 700;
const SOURCE_OFFSET_BASIS =
  "sanitized UTF-16 code units after redaction and whitespace normalization" as const;
const MAX_SPANS_PER_REQUEST = 14;
const MAX_PARALLEL_REQUESTS = 2;
const MAX_REQUESTS = Math.ceil(MAX_SOURCE_SPANS / MAX_SPANS_PER_REQUEST);
const MAX_STATE_CHARS = 24_000;
const MAX_PHASED_REQUEST_CHARS = 240_000;
const MAX_PHASED_ITEMS_PER_REQUEST = 16;
const MAX_USER_CONTEXT_MESSAGES = 3;
const MAX_USER_CONTEXT_CHARS = 400;
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 600;
const MAX_FILE_PATHS = 64;
const MINIMUM_SAVINGS_RATIO = 0.2;
const MAX_RESERVE_FRACTION = 0.8;
const COMPACTION_SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";
const DETAILS_KEY = "fastJev";
const DETAILS_VERSION = 3;
const LEGACY_DETAILS_VERSIONS = new Set([1, 2]);

export const FAST_JEV_STATUS_EVENT = "fast_jev_compaction_status";

export type FastJevFailureReason =
  | "cancelled"
  | "caller-cancellation"
  | "no-source-spans"
  | "source-span-limit"
  | "local-state-too-large"
  | "malformed-jev"
  | "invalid-json"
  | "oversized-body"
  | "missing-credentials"
  | "auth-failure"
  | "timeout"
  | "request-failure"
  | "body-failure"
  | "http-status"
  | "insufficient-savings"
  | "protected-too-large"
  | "final-size-limit"
  | "unexpected";

export interface FastJevFailureDiagnostics {
  readonly provider: JevGatewayFailure["provider"];
  readonly stage: JevGatewayFailure["stage"];
  readonly reason: JevGatewayFailure["reason"];
  readonly httpStatus?: number;
}

type FastJevFailureKind = "unavailable" | "refused" | "cancelled";

interface FastJevFailure {
  readonly kind: FastJevFailureKind;
  readonly reason: FastJevFailureReason;
  readonly diagnostic?: FastJevFailureDiagnostics;
}

export interface FastJevAttemptStatus {
  readonly version: 3;
  readonly outcome: "compacted" | "native-fallback" | "refused" | "cancelled";
  readonly path: "jev" | "native" | "none";
  readonly reason?: FastJevFailureReason;
  readonly diagnostic?: FastJevFailureDiagnostics;
  readonly jevMs: number;
  readonly totalMs: number;
  readonly beforeChars: number;
  readonly afterChars: number;
  readonly spans: number;
  readonly requests: number;
  readonly selection?: PhasedSelectionDiagnostic;
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

export interface FastJevCompactionConfig {
  readonly enabled: boolean;
  readonly phased?: boolean;
}

export function resolveFastJevCompactionConfig(globalSettings: unknown): FastJevCompactionConfig {
  if (!isRecord(globalSettings) || !isRecord(globalSettings.jev)) return { enabled: false };
  const raw = globalSettings.jev[SETTINGS_KEY];
  if (!isRecord(raw) || raw.enabled !== true) return { enabled: false };
  return raw.phased === true ? { enabled: true, phased: true } : { enabled: true };
}

interface FastJevCompactionSettings {
  readonly config: FastJevCompactionConfig;
  readonly loadFailed: boolean;
}

function readGlobalConfig(): FastJevCompactionSettings {
  try {
    const settings = SettingsManager.create(process.cwd(), getAgentDir(), {
      projectTrusted: false,
    });
    const config = resolveFastJevCompactionConfig(settings.getGlobalSettings());
    return { config, loadFailed: settings.drainErrors().length > 0 };
  } catch {
    return { config: { enabled: false }, loadFailed: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    } else if (isRecord(part) && part.type === "image") {
      parts.push("[image]");
    }
  }
  return parts.join("\n");
}

function redact(value: string, limit = Number.MAX_SAFE_INTEGER): string {
  const withoutControls = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : character;
    })
    .join("");
  return withoutControls
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(
      /(["']?)(api[_-]?key|token|secret|password)\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/giu,
      (_match, keyQuote: string, key: string, separator: string, rawValue: string) => {
        const replacement = rawValue.startsWith('"')
          ? '"[redacted]"'
          : rawValue.startsWith("'")
            ? "'[redacted]'"
            : "[redacted]";
        return `${keyQuote}${key}${keyQuote}${separator}${replacement}`;
      },
    )
    .replace(/(?:~|\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)[^\s"'`,}]*/gu, "[redacted-path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

type SanitizedJsonValue =
  | null
  | boolean
  | number
  | string
  | SanitizedJsonValue[]
  | { [key: string]: SanitizedJsonValue };

function sanitizeStructuredValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): SanitizedJsonValue {
  if (value === null) return null;
  if (typeof value === "string") return redact(value);
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") return "[unserializable]";
  if (ancestors.has(value)) return "[circular]";

  ancestors.add(value);
  let sanitized: SanitizedJsonValue;
  if (Array.isArray(value)) {
    sanitized = value.map((item) => sanitizeStructuredValue(item, ancestors));
  } else if (isRecord(value)) {
    sanitized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:api[_-]?key|token|secret|password)$/iu.test(key)
          ? "[redacted]"
          : sanitizeStructuredValue(item, ancestors),
      ]),
    );
  } else {
    sanitized = "[unserializable]";
  }
  ancestors.delete(value);
  return sanitized;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(sanitizeStructuredValue(value)) ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}

export function redactFactSourceText(value: string, limit = Number.MAX_SAFE_INTEGER): string {
  return redact(value, limit);
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

function sourceMessageText(raw: Record<string, unknown>): string {
  if (raw.role === "bashExecution") {
    const command = typeof raw.command === "string" ? raw.command : "";
    const output = typeof raw.output === "string" ? raw.output : "";
    const exitCode = typeof raw.exitCode === "number" ? `\n[bash exit code] ${raw.exitCode}` : "";
    const cancelled = raw.cancelled === true ? "\n[bash cancelled]" : "";
    return `[bash command] ${command}\n[bash output] ${output}${exitCode}${cancelled}`;
  }
  if (raw.role === "branchSummary" || raw.role === "compactionSummary") {
    return `[${raw.role}] ${typeof raw.summary === "string" ? raw.summary : ""}`;
  }
  if (raw.role === "custom" || raw.role === "custom_message") {
    return `[${raw.role}] ${contentText(raw.content)}`;
  }
  return raw.role === "toolResult" ? "" : contentText(raw.content);
}

/** Converts Pi messages into private copies; the source transcript is never edited. */
export function toFastJevMessages(messages: readonly unknown[]): FastJevMessage[] {
  const result: FastJevMessage[] = [];
  for (const raw of messages) {
    if (!isRecord(raw) || raw.excludeFromContext === true) continue;
    const calls: Array<FastJevMessage["toolCalls"][number]> = [];
    if (Array.isArray(raw.content)) {
      for (const part of raw.content) {
        if (!isRecord(part) || part.type !== "toolCall") continue;
        if (typeof part.id !== "string" || typeof part.name !== "string") continue;
        calls.push({
          toolUseId: part.id,
          name: part.name,
          input: inputRecord(part.arguments),
        });
      }
    }
    const toolResults: ToolResult[] =
      raw.role === "toolResult" && typeof raw.toolCallId === "string"
        ? [
            {
              toolUseId: raw.toolCallId,
              text: contentText(raw.content),
              isError: raw.isError === true,
            },
          ]
        : [];
    result.push({
      role: raw.role === "assistant" ? "assistant" : "user",
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

interface PreviousState {
  readonly summary?: string;
  readonly messages?: FastJevMessage[];
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
    if (!isRecord(details) || !isRecord(details[DETAILS_KEY])) {
      return entrySummary ? { summary: entrySummary } : {};
    }
    const stored = details[DETAILS_KEY];
    if (stored.version === DETAILS_VERSION) {
      return entrySummary ? { summary: entrySummary } : {};
    }
    if (
      typeof stored.version !== "number" ||
      !LEGACY_DETAILS_VERSIONS.has(stored.version) ||
      !Array.isArray(stored.messages)
    ) {
      return entrySummary ? { summary: entrySummary } : {};
    }
    const messages = stored.messages.filter(validStoredMessage).map(copyMessage);
    return {
      ...(entrySummary ? { summary: entrySummary } : {}),
      messages,
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

const SAFE_TO_RECREATE = new Set(["read", "grep", "find", "ls", "glob", "search", "cat", "pwd"]);

type SourceSpanKind =
  | "prior-summary"
  | "legacy-detail"
  | "user"
  | "assistant"
  | "tool-call"
  | "tool-result";

export interface SourceSpan {
  readonly id: string;
  readonly kind: SourceSpanKind;
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly mandatory: boolean;
  readonly retirementEligible?: boolean;
  readonly retirementWitness?: boolean;
  readonly toolCallId?: string;
  readonly toolCallPart?: "call" | "result";
}

interface ParsedPriorSummary {
  readonly spans: readonly Omit<SourceSpan, "id" | "mandatory">[];
  readonly fileOperations: string;
}

function isSourceSpanKind(value: string): value is SourceSpanKind {
  return (
    value === "prior-summary" ||
    value === "legacy-detail" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool-call" ||
    value === "tool-result"
  );
}

function parsePriorV3Summary(summary: string): ParsedPriorSummary | undefined {
  const lines = summary.split("\n");
  if (
    lines[0] !== "<fast-jev-compaction>" ||
    lines[1] !==
      "Selection-only continuation record. Source text is copied, not summarized or inferred." ||
    lines[2] !== "<selected-source-spans>"
  ) {
    return undefined;
  }
  const sectionStart = 2;
  const sectionEnd = lines.indexOf("</selected-source-spans>", sectionStart + 1);
  if (
    sectionEnd <= sectionStart ||
    sectionEnd !== lines.length - 5 ||
    lines[sectionEnd + 1] !== "Pi file operations (source: CompactionPreparation.fileOps):" ||
    lines[lines.length - 1] !== "</fast-jev-compaction>"
  ) {
    return undefined;
  }
  const fileOperationListPattern = /^(?:none|"(?:\\.|[^"\\])*"(?:, "(?:\\.|[^"\\])*")*)$/u;
  const readLine = lines[sectionEnd + 2];
  const modifiedLine = lines[sectionEnd + 3];
  if (
    readLine === undefined ||
    !readLine.startsWith("read: ") ||
    !fileOperationListPattern.test(readLine.slice("read: ".length)) ||
    modifiedLine === undefined ||
    !modifiedLine.startsWith("modified: ") ||
    !fileOperationListPattern.test(modifiedLine.slice("modified: ".length))
  ) {
    return undefined;
  }

  const headerPattern =
    /^\[source (s\d+); kind ([a-z-]+); origin ("(?:\\.|[^"\\])*"); range \(([^)]*)\) (\d+):(\d+)(?:; tool (call|result) ("(?:\\.|[^"\\])*"))?\]$/u;
  const spans: Array<Omit<SourceSpan, "id" | "mandatory">> = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 2) {
    const header = lines[index];
    const match = header === undefined ? null : headerPattern.exec(header);
    if (match === null) return undefined;
    const [, , rawKind, rawSource, rawOffsetBasis, rawStart, rawEnd, rawToolPart, rawToolId] =
      match;
    if (!rawKind || !isSourceSpanKind(rawKind) || rawOffsetBasis !== SOURCE_OFFSET_BASIS)
      return undefined;
    const start = Number(rawStart);
    const end = Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
      return undefined;

    let source: unknown;
    let text: unknown;
    let toolCallId: unknown;
    try {
      source = JSON.parse(rawSource ?? "");
      text = JSON.parse(lines[index + 1] ?? "");
      if (rawToolId !== undefined) toolCallId = JSON.parse(rawToolId);
    } catch {
      return undefined;
    }
    if (typeof source !== "string" || typeof text !== "string") return undefined;
    const sanitizedSource = redact(source, 240);
    const sanitizedText = redact(text);
    const sanitizedToolCallId = typeof toolCallId === "string" ? redact(toolCallId) : undefined;
    if (
      sanitizedSource !== source ||
      sanitizedText !== text ||
      sanitizedText.length !== end - start ||
      (rawToolPart !== undefined && rawToolPart !== "call" && rawToolPart !== "result") ||
      (rawToolPart !== undefined && typeof toolCallId !== "string") ||
      (rawToolPart === undefined && rawToolId !== undefined) ||
      (typeof toolCallId === "string" && sanitizedToolCallId !== toolCallId)
    ) {
      return undefined;
    }
    spans.push({
      kind: rawKind,
      source: sanitizedSource,
      start,
      end,
      text: sanitizedText,
      ...(rawToolPart === undefined
        ? {}
        : { toolCallId: sanitizedToolCallId!, toolCallPart: rawToolPart }),
    });
  }
  if (spans.length === 0) return undefined;
  return {
    spans,
    fileOperations: lines.slice(sectionEnd + 1, -1).join("\n"),
  };
}

interface SourceSpanCollection {
  readonly spans: readonly SourceSpan[];
  readonly overflow: boolean;
}

function sourceSpans(
  preparedMessages: readonly unknown[],
  previous: PreviousState,
): SourceSpanCollection {
  const spans: SourceSpan[] = [];
  let overflow = false;
  const addText = (
    kind: SourceSpanKind,
    source: string,
    text: string,
    mandatory: boolean,
    toolCallId?: string,
    toolCallPart?: "call" | "result",
    retirementEligible = false,
  ): void => {
    const sanitizedText = redact(text);
    if (!sanitizedText) return;
    for (let start = 0; start < sanitizedText.length; start += MAX_SOURCE_SPAN_CHARS) {
      if (spans.length >= MAX_SOURCE_SPANS) {
        overflow = true;
        return;
      }
      let end = Math.min(start + MAX_SOURCE_SPAN_CHARS, sanitizedText.length);
      if (end < sanitizedText.length && end > start) {
        const last = sanitizedText.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end -= 1;
      }
      spans.push({
        id: `s${spans.length + 1}`,
        kind,
        source,
        start,
        end,
        text: sanitizedText.slice(start, end),
        mandatory,
        ...(retirementEligible ? { retirementEligible: true } : {}),
        ...(toolCallId === undefined ? {} : { toolCallId }),
        ...(toolCallPart === undefined ? {} : { toolCallPart }),
      });
      if (overflow) return;
      start = end - MAX_SOURCE_SPAN_CHARS;
    }
  };

  if (previous.summary) {
    const parsed = parsePriorV3Summary(previous.summary);
    if (parsed === undefined) {
      addText(
        "prior-summary",
        "prior compaction summary",
        previous.summary,
        true,
        undefined,
        undefined,
        true,
      );
    } else {
      for (const priorSpan of parsed.spans) {
        if (spans.length >= MAX_SOURCE_SPANS) {
          overflow = true;
          break;
        }
        spans.push({
          id: `s${spans.length + 1}`,
          ...priorSpan,
          source: redact(priorSpan.source, 240),
          text: redact(priorSpan.text),
          mandatory: true,
          retirementEligible: true,
        });
      }
      if (!overflow)
        addText(
          "prior-summary",
          "prior Pi file operations",
          parsed.fileOperations,
          true,
          undefined,
          undefined,
          true,
        );
    }
  } else {
    for (const [messageIndex, message] of (previous.messages ?? []).entries()) {
      addMessageSpans(
        addText,
        message,
        `legacy persisted detail message ${messageIndex + 1}`,
        true,
      );
      if (overflow) return { spans, overflow };
    }
  }
  if (overflow) return { spans, overflow };

  const filtered = preparedMessages.filter((raw) => {
    if (!previous.summary || !isRecord(raw) || raw.role !== "compactionSummary") return true;
    return typeof raw.summary !== "string" || raw.summary.trim() !== previous.summary;
  });
  const sourceRecords = filtered.filter(
    (raw): raw is Record<string, unknown> => isRecord(raw) && raw.excludeFromContext !== true,
  );
  const messages = toFastJevMessages(filtered);
  const latestUserSource = sourceRecords
    .map((raw, index) => ({ raw, index }))
    .filter(({ raw, index }) => {
      const message = messages[index];
      return raw.role === "user" && message !== undefined && message.text.trim().length > 0;
    })
    .at(-1);
  const latestUserSourceLabel =
    latestUserSource === undefined
      ? undefined
      : `prepared message ${latestUserSource.index + 1} (user)`;
  const failedCallIds = new Set(
    messages.flatMap((message) =>
      message.toolResults.filter((result) => result.isError).map((result) => result.toolUseId),
    ),
  );
  const calls = new Map<
    string,
    { readonly name: string; readonly messageIndex: number; readonly mandatory: boolean }
  >();
  messages.forEach((message, messageIndex) => {
    for (const call of message.toolCalls) {
      const mandatory =
        !SAFE_TO_RECREATE.has(call.name.toLowerCase()) || failedCallIds.has(call.toolUseId);
      calls.set(call.toolUseId, { name: call.name, messageIndex, mandatory });
    }
  });

  messages.forEach((message, messageIndex) => {
    if (message.text.trim().length > 0) {
      const kind = message.role === "user" ? "user" : "assistant";
      const mandatory = message.role === "user";
      addText(
        kind,
        `prepared message ${messageIndex + 1} (${message.role})`,
        message.text,
        mandatory,
        undefined,
        undefined,
        mandatory && `prepared message ${messageIndex + 1} (user)` !== latestUserSourceLabel,
      );
    }
    for (const call of message.toolCalls) {
      const metadata = calls.get(call.toolUseId);
      const mandatory = metadata?.mandatory ?? true;
      const input = safeJson(call.input);
      addText(
        "tool-call",
        `tool call ${call.name} ${call.toolUseId} from prepared message ${messageIndex + 1}`,
        input,
        mandatory,
        call.toolUseId,
        "call",
      );
    }
    for (const result of message.toolResults) {
      const call = calls.get(result.toolUseId);
      const mandatory = result.isError || call === undefined || call.mandatory;
      const source =
        call === undefined
          ? `unmatched tool result ${result.toolUseId} from prepared message ${messageIndex + 1}`
          : `tool result ${result.toolUseId} for ${call.name}; call from prepared message ${call.messageIndex + 1}; result from prepared message ${messageIndex + 1}${result.isError ? "; error" : ""}`;
      addText("tool-result", source, result.text, mandatory, result.toolUseId, "result");
    }
    if (overflow) return;
  });
  const witness = [...spans]
    .reverse()
    .find((span) => span.kind === "user" && span.source === latestUserSourceLabel);
  return {
    spans:
      witness === undefined
        ? spans
        : spans.map((span) =>
            span.id === witness.id ? { ...span, retirementWitness: true } : span,
          ),
    overflow,
  };
}

function addMessageSpans(
  addText: (
    kind: SourceSpanKind,
    source: string,
    text: string,
    mandatory: boolean,
    toolCallId?: string,
    toolCallPart?: "call" | "result",
  ) => void,
  message: FastJevMessage,
  source: string,
  mandatory: boolean,
): void {
  if (message.text.trim().length > 0) addText("legacy-detail", source, message.text, mandatory);
  for (const call of message.toolCalls) {
    addText(
      "legacy-detail",
      `${source}; tool call ${call.name}`,
      safeJson(call.input),
      mandatory,
      call.toolUseId,
      "call",
    );
  }
  for (const result of message.toolResults) {
    addText(
      "legacy-detail",
      `${source}; tool result ${result.toolUseId}`,
      result.text,
      mandatory,
      result.toolUseId,
      "result",
    );
  }
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
    if (
      !isRecord(answer) ||
      answer.type !== "noul" ||
      typeof answer.noul !== "number" ||
      !Number.isFinite(answer.noul) ||
      answer.noul < 0 ||
      answer.noul > 1
    ) {
      return undefined;
    }
    parsed[name] = answer.noul;
  }
  return parsed;
}

export function inferenceState(
  spans: readonly SourceSpan[],
  candidates: readonly SourceSpan[],
  customInstructions: string | undefined,
): Record<string, unknown> {
  const latestUserSource = spans.find((span) => span.retirementWitness)?.source;
  const userMessages = new Map<
    string,
    { readonly source: string; readonly chunks: string[]; readonly latest: boolean }
  >();
  for (const span of spans) {
    if (span.kind !== "user") continue;
    const isCurrent = span.retirementEligible !== true;
    const key = JSON.stringify([span.source, isCurrent ? "current" : "historical"]);
    const message = userMessages.get(key) ?? {
      source: span.source,
      chunks: [],
      latest: isCurrent && span.source === latestUserSource,
    };
    message.chunks.push(span.text);
    userMessages.set(key, message);
  }
  const userContext = [...userMessages.values()]
    .slice(-MAX_USER_CONTEXT_MESSAGES)
    .map(({ source, chunks, latest }) => ({
      source: redact(source, 160),
      text: redact(chunks.join(""), latest ? Number.MAX_SAFE_INTEGER : MAX_USER_CONTEXT_CHARS),
    }));
  return {
    task: "Select source spans that contain useful continuation facts; the renderer copies selected text verbatim and creates no summary prose.",
    user_constraints: userContext,
    focus_instructions: customInstructions?.trim()
      ? redact(customInstructions, MAX_CUSTOM_INSTRUCTIONS_CHARS)
      : "",
    source_range_offset_basis: SOURCE_OFFSET_BASIS,
    candidates: candidates.map((span) => ({
      id: span.id,
      kind: span.kind,
      source: redact(span.source, 240),
      source_range: [span.start, span.end],
      ...(span.toolCallId === undefined
        ? {}
        : {
            tool_call_id: redact(span.toolCallId),
            tool_call_part: span.toolCallPart,
          }),
      text: span.text,
    })),
  };
}

function questionFor(span: SourceSpan): Record<string, unknown> {
  const id = `retain_${span.id}`;
  return {
    [id]: {
      type: "noul",
      instructions: `Should source span ${span.id} remain in the continuation record because it contains task constraints, evidence, decisions, action outcomes, or context that cannot be safely omitted?`,
      criteria: {
        true: "Keep this source span because it contributes a non-redundant fact useful for continuing the task.",
        false:
          "Omit this source span because it is routine, stale, redundant, or safely reproducible.",
      },
    },
  };
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function fileList(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  return [...new Set(values.filter((path): path is string => typeof path === "string"))]
    .map((path) => redact(path, 400))
    .filter(Boolean)
    .sort()
    .slice(0, MAX_FILE_PATHS);
}

function renderFileOperations(preparation: SessionBeforeCompactEvent["preparation"]): string {
  const fileOps = preparation.fileOps as unknown;
  if (!isRecord(fileOps)) return "Pi file operations: unavailable.";
  const modified = new Set([...fileList(fileOps.written), ...fileList(fileOps.edited)]);
  const read = fileList(fileOps.read).filter((path) => !modified.has(path));
  return [
    "Pi file operations (source: CompactionPreparation.fileOps):",
    `read: ${read.length > 0 ? read.map(quote).join(", ") : "none"}`,
    `modified: ${modified.size > 0 ? [...modified].sort().map(quote).join(", ") : "none"}`,
  ].join("\n");
}

function selectWithCallDependencies(
  spans: readonly SourceSpan[],
  decisions: ReadonlyMap<string, boolean>,
): SourceSpan[] {
  const selectedIds = new Set(
    spans
      .filter((span) => span.mandatory || decisions.get(span.id) === true)
      .map((span) => span.id),
  );
  const callSpanIds = new Map<string, string[]>();
  for (const span of spans) {
    if (span.toolCallPart !== "call" || span.toolCallId === undefined) continue;
    const ids = callSpanIds.get(span.toolCallId) ?? [];
    ids.push(span.id);
    callSpanIds.set(span.toolCallId, ids);
  }
  for (const span of spans) {
    if (
      !selectedIds.has(span.id) ||
      span.toolCallPart !== "result" ||
      span.toolCallId === undefined
    ) {
      continue;
    }
    for (const callSpanId of callSpanIds.get(span.toolCallId) ?? []) selectedIds.add(callSpanId);
  }
  return spans.filter((span) => selectedIds.has(span.id));
}

function renderSelection(
  selected: readonly PhasedSourceSpan[],
  preparation: SessionBeforeCompactEvent["preparation"],
): string {
  const lines = [
    "<fast-jev-compaction>",
    "Selection-only continuation record. Source text is copied, not summarized or inferred.",
    "<selected-source-spans>",
  ];
  for (const span of selected) {
    lines.push(
      `[source ${span.id}; kind ${span.kind}; origin ${quote(redact(span.source, 240))}; range (${SOURCE_OFFSET_BASIS}) ${span.start}:${span.end}${span.toolCallId === undefined ? "" : `; tool ${span.toolCallPart} ${quote(redact(span.toolCallId))}`}]`,
      quote(span.text),
    );
  }
  lines.push(
    "</selected-source-spans>",
    renderFileOperations(preparation),
    "</fast-jev-compaction>",
  );
  return lines.join("\n");
}

function messageChars(message: FastJevMessage): number {
  return (
    message.text.length +
    message.toolCalls.reduce((sum, call) => sum + safeJson(call.input).length, 0) +
    message.toolResults.reduce((sum, result) => sum + result.text.length, 0)
  );
}

function wrappedSummaryChars(text: string): number {
  return `${COMPACTION_SUMMARY_PREFIX}${text}${COMPACTION_SUMMARY_SUFFIX}`.length;
}

function renderedTokens(text: string): number {
  return Math.ceil(wrappedSummaryChars(text) / 4);
}

function renderFitsBudget(
  text: string,
  preparation: SessionBeforeCompactEvent["preparation"],
): boolean {
  const reserveTokens = preparation.settings.reserveTokens;
  return (
    Number.isSafeInteger(reserveTokens) &&
    reserveTokens > 0 &&
    renderedTokens(text) <= Math.floor(reserveTokens * MAX_RESERVE_FRACTION)
  );
}

function makeStatus(
  outcome: FastJevAttemptStatus["outcome"],
  path: FastJevAttemptStatus["path"],
  reason: FastJevFailureReason | undefined,
  jevMs: number,
  totalMs: number,
  beforeChars: number,
  afterChars: number,
  spans: number,
  requests: number,
  diagnostic?: FastJevFailureDiagnostics,
  selection?: PhasedSelectionDiagnostic,
): FastJevAttemptStatus {
  return {
    version: 3,
    outcome,
    path,
    ...(reason === undefined ? {} : { reason }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(selection === undefined ? {} : { selection }),
    jevMs,
    totalMs,
    beforeChars,
    afterChars,
    spans,
    requests,
  };
}

function gatewayFailureDisposition(failure: JevGatewayFailure): FastJevFailure {
  const diagnostic: FastJevFailureDiagnostics = {
    provider: failure.provider,
    stage: failure.stage,
    reason: failure.reason,
    ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
  };
  switch (failure.reason) {
    case "missing-credentials":
    case "auth-failure":
    case "timeout":
    case "request-failure":
    case "body-failure":
      return { kind: "unavailable", reason: failure.reason, diagnostic };
    case "caller-cancellation":
      return { kind: "cancelled", reason: failure.reason, diagnostic };
    case "http-status": {
      const status = failure.httpStatus;
      // 404 can mean this provider does not offer its configured Jev model; Pi's native model is separate.
      const unavailable =
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 408 ||
        status === 429 ||
        (status !== undefined && status >= 500);
      return {
        kind: unavailable ? "unavailable" : "refused",
        reason: "http-status",
        diagnostic,
      };
    }
    case "invalid-json":
      return { kind: "refused", reason: "invalid-json", diagnostic };
    case "oversized-body":
      return { kind: "refused", reason: "oversized-body", diagnostic };
  }
  return { kind: "refused", reason: "unexpected", diagnostic };
}

function monotonicMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

export interface FastJevRunOptions {
  readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "getProviderAuth">;
  readonly signal?: AbortSignal;
  readonly fetch?: JevGatewayFetch;
  readonly onStatus?: (status: FastJevAttemptStatus) => void;
  readonly phased?: boolean;
}

interface PhasedRequest {
  readonly state: Record<string, unknown>;
  readonly questions: Record<string, unknown>;
  readonly answerNames: readonly string[];
}

function phasedEvidence(spans: readonly PhasedSourceSpan[]): Record<string, unknown>[] {
  const evidence: Array<{
    kind: string;
    source: string;
    start: number;
    end: number;
    text: string;
    toolCallId?: string;
    toolCallPart?: "call" | "result";
  }> = [];
  for (const span of spans) {
    const previous = evidence[evidence.length - 1];
    if (
      previous !== undefined &&
      previous.kind === span.kind &&
      previous.source === span.source &&
      previous.end === span.start &&
      previous.toolCallId === span.toolCallId &&
      previous.toolCallPart === span.toolCallPart
    ) {
      previous.end = span.end;
      previous.text += span.text;
      continue;
    }
    evidence.push({
      kind: span.kind,
      source: span.source,
      start: span.start,
      end: span.end,
      text: span.text,
      ...(span.toolCallId === undefined ? {} : { toolCallId: span.toolCallId }),
      ...(span.toolCallPart === undefined ? {} : { toolCallPart: span.toolCallPart }),
    });
  }
  return evidence.map((item) => ({
    kind: item.kind,
    source: item.source,
    source_range: [item.start, item.end],
    text: item.text,
    ...(item.toolCallId === undefined
      ? {}
      : { tool_call_id: item.toolCallId, tool_call_part: item.toolCallPart }),
  }));
}

function phasedRequest(
  baseState: Record<string, unknown>,
  phase: PhasedPhase,
  candidates: readonly PhasedCandidate[],
): PhasedRequest {
  const answerNames = candidates.map((candidate) => `${candidate.judgment}_${candidate.id}`);
  const questions = Object.fromEntries(
    candidates.map((candidate, index) => [
      answerNames[index]!,
      {
        type: "noul",
        instructions:
          candidate.judgment === "retire"
            ? `May candidate ${candidate.id}, the complete historical evidence group ${candidate.groupId}, be retired? Compare all of its evidence with the complete latest-user witness group ${candidate.witness?.groupId ?? "missing"}; retire only if the witness explicitly shows every historical fact is duplicated, superseded, or resolved without losing an active constraint, unfinished obligation, or consequential outcome. Uncertainty means retain.`
            : phase === "coarse"
              ? `Should candidate ${candidate.id}, the complete evidence group ${candidate.groupId} (all evidence listed for this candidate), remain in the continuation record? Retain if any part contains a useful, non-redundant continuation fact.`
              : `Should candidate ${candidate.id}, this bounded chunk of evidence group ${candidate.groupId}, remain in the continuation record? Retain if any listed evidence is useful for continuing the task.`,
      },
    ]),
  );
  return {
    state: {
      ...baseState,
      task:
        phase === "coarse"
          ? "Select useful continuation evidence. Retire a historical source group only when every complete candidate span is explicitly shown by its named complete latest-user witness group to be duplicated, superseded, or resolved, with no active constraint, unfinished obligation, or consequential outcome lost. Uncertainty means retain. Other judgments select evidence for verbatim rendering; do not summarize or generate prose."
          : "Refine the selected evidence by retaining only source spans needed for continuation. The renderer copies selected source text verbatim; do not summarize or generate prose.",
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        group_id: candidate.groupId,
        judgment: candidate.judgment,
        evidence: phasedEvidence(candidate.spans),
        ...(candidate.witness === undefined
          ? {}
          : { retirement_witness_group_id: candidate.witness.groupId }),
      })),
      retirement_witness_groups: [
        ...new Map(
          candidates.flatMap((candidate) =>
            candidate.witness === undefined
              ? []
              : [
                  [
                    candidate.witness.groupId,
                    {
                      id: candidate.witness.groupId,
                      evidence: phasedEvidence(candidate.witness.spans),
                    },
                  ] as const,
                ],
          ),
        ).values(),
      ],
    },
    questions,
    answerNames,
  };
}

async function runPhasedJevSelection(
  preparation: SessionBeforeCompactEvent["preparation"],
  spans: readonly SourceSpan[],
  beforeChars: number,
  options: FastJevRunOptions,
  customInstructions: string | undefined,
): Promise<PhasedSelectionResult<FastJevFailureDiagnostics>> {
  const baseState = inferenceState(spans, [], customInstructions);
  const buildRequest = (phase: PhasedPhase, candidates: readonly PhasedCandidate[]) =>
    phasedRequest(baseState, phase, candidates);
  const preflight = (phase: PhasedPhase, candidates: readonly PhasedCandidate[]) => {
    const request = buildRequest(phase, candidates);
    return (
      safeJson({ state: request.state, questions: request.questions }).length <=
      MAX_PHASED_REQUEST_CHARS
    );
  };
  return runPhasedSelection(spans, {
    originalChars: beforeChars,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    deadlineMs: MAX_JEV_DURATION_MS,
    maxItemsPerRequest: MAX_PHASED_ITEMS_PER_REQUEST,
    preflight,
    judge: async (phase, candidates, signal, remainingMs) => {
      const request = buildRequest(phase, candidates);
      if (!preflight(phase, candidates))
        return { kind: "refused", reason: "local-state-too-large" };
      const gateway = await requestJevGateway(
        options.modelRegistry,
        { state: request.state, questions: request.questions },
        {
          timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
          signal,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        },
      );
      if (!gateway.ok) {
        const failure = gatewayFailureDisposition(gateway);
        const diagnostic = failure.diagnostic;
        switch (failure.kind) {
          case "unavailable":
            return {
              kind: "unavailable",
              reason: failure.reason,
              ...(diagnostic === undefined ? {} : { diagnostic }),
            };
          case "refused":
            return {
              kind: "refused",
              reason: failure.reason,
              ...(diagnostic === undefined ? {} : { diagnostic }),
            };
          case "cancelled":
            return {
              kind: "cancelled",
              reason: "caller-cancellation",
              ...(diagnostic === undefined ? {} : { diagnostic }),
            };
        }
      }
      const answers = parseNoulAnswers(gateway.value, request.answerNames);
      if (answers === undefined) return { kind: "refused", reason: "malformed-jev" };
      const mappedAnswers: Record<string, number> = {};
      for (const [index, candidate] of candidates.entries()) {
        const answer = answers[request.answerNames[index]!];
        if (answer === undefined) return { kind: "refused", reason: "malformed-jev" };
        mappedAnswers[`${candidate.judgment}_${candidate.id}`] = answer;
      }
      return { kind: "answers", answers: mappedAnswers };
    },
    render: (selected) => renderSelection(selected, preparation),
    wrappedChars: wrappedSummaryChars,
    fitsPiBudget: (summary) => renderFitsBudget(summary, preparation),
  });
}

export interface FastJevResult {
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly details: {
    readonly readFiles: string[];
    readonly modifiedFiles: string[];
    readonly [DETAILS_KEY]: {
      readonly version: 3;
      readonly reductionRatio: number;
      readonly selectedSpans: readonly {
        readonly id: string;
        readonly kind: SourceSpanKind;
        readonly source: string;
        readonly start: number;
        readonly end: number;
        readonly offsetBasis: typeof SOURCE_OFFSET_BASIS;
        readonly toolCallId?: string;
        readonly toolCallPart?: "call" | "result";
      }[];
      readonly attempt: FastJevAttemptStatus;
    };
  };
}

export type FastJevRunOutcome =
  | { readonly kind: "success"; readonly result: FastJevResult }
  | { readonly kind: "unavailable"; readonly status: FastJevAttemptStatus }
  | { readonly kind: "refused"; readonly status: FastJevAttemptStatus }
  | { readonly kind: "cancelled"; readonly status: FastJevAttemptStatus };

export async function runFastJevCompaction(
  preparation: SessionBeforeCompactEvent["preparation"],
  branchEntries: readonly unknown[],
  options: FastJevRunOptions,
  customInstructions?: string,
): Promise<FastJevRunOutcome> {
  const startedAt = performance.now();
  const finish = (
    kind: FastJevFailureKind,
    reason: FastJevFailureReason,
    jevMs: number,
    beforeChars: number,
    spans: number,
    requests: number,
    diagnostic?: FastJevFailureDiagnostics,
    afterChars = beforeChars,
    selection?: PhasedSelectionDiagnostic,
  ): Exclude<FastJevRunOutcome, { readonly kind: "success" }> => {
    const status = makeStatus(
      kind === "cancelled" ? "cancelled" : "native-fallback",
      kind === "cancelled" ? "none" : "native",
      reason,
      jevMs,
      monotonicMs(startedAt),
      beforeChars,
      afterChars,
      spans,
      requests,
      diagnostic,
      selection,
    );
    options.onStatus?.(status);
    return { kind, status };
  };
  const finishRefusal = (
    reason: FastJevFailureReason,
    jevMs: number,
    beforeChars: number,
    spans: number,
    requests: number,
  ) => finish("refused", reason, jevMs, beforeChars, spans, requests);
  const preparedMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  if (options.signal?.aborted) return finish("cancelled", "caller-cancellation", 0, 0, 0, 0);

  const previous = previousState(branchEntries, preparation.previousSummary);
  const collection = sourceSpans(preparedMessages, previous);
  const spans = collection.spans;
  const legacyMessages = previous.summary ? [] : (previous.messages ?? []);
  const transcriptMessages = toFastJevMessages(
    preparedMessages.filter((raw) => {
      if (!previous.summary || !isRecord(raw) || raw.role !== "compactionSummary") return true;
      return typeof raw.summary !== "string" || raw.summary.trim() !== previous.summary;
    }),
  );
  const beforeChars =
    (previous.summary?.length ?? 0) +
    legacyMessages.reduce((sum, message) => sum + messageChars(message), 0) +
    transcriptMessages.reduce((sum, message) => sum + messageChars(message), 0);

  if (collection.overflow)
    return finishRefusal("source-span-limit", 0, beforeChars, spans.length, 0);
  if (spans.length === 0) return finishRefusal("no-source-spans", 0, beforeChars, 0, 0);

  const candidates = spans.filter((span) => !span.mandatory);
  const batches: SourceSpan[][] = [];
  for (let index = 0; index < candidates.length; index += MAX_SPANS_PER_REQUEST) {
    batches.push(candidates.slice(index, index + MAX_SPANS_PER_REQUEST));
  }
  if (batches.length > MAX_REQUESTS) {
    return finishRefusal("source-span-limit", 0, beforeChars, spans.length, 0);
  }

  const jevStartedAt = performance.now();
  const deadline = new AbortController();
  const onCallerAbort = () => deadline.abort();
  if (options.signal?.aborted) deadline.abort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => deadline.abort(), MAX_JEV_DURATION_MS);
  const decisions = new Map<string, boolean>();
  let failure: FastJevFailure | undefined;
  let requests = 0;
  let phasedSelectionDiagnostic: PhasedSelectionDiagnostic | undefined;
  let phasedJevMs: number | undefined;
  let phasedSelectedIds: ReadonlySet<string> | undefined;

  try {
    if (options.phased) {
      const phased = await runPhasedJevSelection(
        preparation,
        spans,
        beforeChars,
        options,
        customInstructions,
      );
      requests = phased.requests;
      if (phased.kind !== "success") {
        phasedSelectionDiagnostic = phased.selection;
        phasedJevMs = phased.requests === 0 ? 0 : phased.durationMs;
        failure = {
          kind: phased.kind,
          reason: phased.reason,
          ...(phased.diagnostic === undefined ? {} : { diagnostic: phased.diagnostic }),
        };
      } else {
        const selectedIds = new Set(phased.selected.map((span) => span.id));
        phasedSelectedIds = selectedIds;
        for (const candidate of candidates)
          decisions.set(candidate.id, selectedIds.has(candidate.id));
      }
    } else {
      for (let offset = 0; offset < batches.length; offset += MAX_PARALLEL_REQUESTS) {
        if (options.signal?.aborted) {
          failure = { kind: "cancelled", reason: "caller-cancellation" };
          break;
        }
        const remainingMs = MAX_JEV_DURATION_MS - monotonicMs(jevStartedAt);
        if (deadline.signal.aborted || remainingMs <= 0) {
          failure = { kind: "unavailable", reason: "timeout" };
          break;
        }
        const round = batches.slice(offset, offset + MAX_PARALLEL_REQUESTS);
        const roundResults = await Promise.all(
          round.map(async (batch) => {
            const state = inferenceState(spans, batch, customInstructions);
            const questions = Object.assign({}, ...batch.flatMap((span) => [questionFor(span)]));
            const names = batch.map((span) => `retain_${span.id}`);
            if (safeJson(state).length > MAX_STATE_CHARS)
              return { failure: { kind: "refused", reason: "local-state-too-large" } as const };
            requests += 1;
            const gateway = await requestJevGateway(
              options.modelRegistry,
              { state, questions },
              {
                timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs),
                signal: deadline.signal,
                ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
              },
            );
            if (!gateway.ok) return { failure: gatewayFailureDisposition(gateway) };
            const answers = parseNoulAnswers(gateway.value, names);
            return answers === undefined
              ? { failure: { kind: "refused", reason: "malformed-jev" } as const }
              : { answers };
          }),
        );
        if (options.signal?.aborted) {
          failure = { kind: "cancelled", reason: "caller-cancellation" };
          break;
        }
        if (deadline.signal.aborted) {
          failure = { kind: "unavailable", reason: "timeout" };
          break;
        }
        const failed = roundResults.find((result) => "failure" in result);
        if (failed && "failure" in failed) {
          failure = failed.failure;
          break;
        }
        // Decisions stay provisional until every bounded request has a fully valid answer set.
        for (const [batchIndex, batch] of round.entries()) {
          const result = roundResults[batchIndex];
          if (!result || !("answers" in result)) {
            failure = { kind: "refused", reason: "malformed-jev" };
            break;
          }
          for (const span of batch) {
            const score = result.answers[`retain_${span.id}`];
            if (score === undefined) {
              failure = { kind: "refused", reason: "malformed-jev" };
              break;
            }
            decisions.set(span.id, score >= KEEP_THRESHOLD);
          }
          if (failure) break;
        }
        if (failure) break;
      }
    }
  } catch {
    failure = options.signal?.aborted
      ? { kind: "cancelled", reason: "caller-cancellation" }
      : deadline.signal.aborted
        ? { kind: "unavailable", reason: "timeout" }
        : { kind: "refused", reason: "unexpected" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }

  const jevMs = phasedJevMs ?? monotonicMs(jevStartedAt);
  if (options.signal?.aborted) failure = { kind: "cancelled", reason: "caller-cancellation" };
  if (failure)
    return finish(
      failure.kind,
      failure.reason,
      jevMs,
      beforeChars,
      spans.length,
      requests,
      failure.diagnostic,
      phasedSelectionDiagnostic?.afterChars ?? beforeChars,
      phasedSelectionDiagnostic,
    );
  if (decisions.size !== candidates.length) {
    return finishRefusal("malformed-jev", jevMs, beforeChars, spans.length, requests);
  }

  const selected =
    phasedSelectedIds === undefined
      ? selectWithCallDependencies(spans, decisions)
      : spans.filter((span) => phasedSelectedIds.has(span.id));
  const summary = renderSelection(selected, preparation);
  const afterChars = wrappedSummaryChars(summary);
  const savingsRatio = beforeChars > 0 ? (beforeChars - afterChars) / beforeChars : 0;
  if (savingsRatio < MINIMUM_SAVINGS_RATIO) {
    return finishRefusal("insufficient-savings", jevMs, beforeChars, spans.length, requests);
  }
  if (!renderFitsBudget(summary, preparation)) {
    return finishRefusal("final-size-limit", jevMs, beforeChars, spans.length, requests);
  }

  const attempt = makeStatus(
    "compacted",
    "jev",
    undefined,
    jevMs,
    monotonicMs(startedAt),
    beforeChars,
    afterChars,
    spans.length,
    requests,
  );
  options.onStatus?.(attempt);
  const fileOps = preparation.fileOps as unknown;
  const readFiles = isRecord(fileOps) ? fileList(fileOps.read) : [];
  const modifiedFiles = isRecord(fileOps)
    ? [...new Set([...fileList(fileOps.written), ...fileList(fileOps.edited)])].sort()
    : [];
  const selectedSpans = selected.map(
    ({ id, kind, source, start, end, toolCallId, toolCallPart }) => ({
      id,
      kind,
      source: redact(source, 240),
      start,
      end,
      offsetBasis: SOURCE_OFFSET_BASIS,
      ...(toolCallId === undefined ? {} : { toolCallId, toolCallPart }),
    }),
  );
  return {
    kind: "success",
    result: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: {
        readFiles,
        modifiedFiles,
        [DETAILS_KEY]: {
          version: DETAILS_VERSION,
          reductionRatio: savingsRatio,
          selectedSpans,
          attempt,
        },
      },
    },
  };
}

export function toPiCompactionResponse(result: FastJevRunOutcome) {
  switch (result.kind) {
    case "success":
      return { compaction: result.result };
    case "unavailable":
    case "refused":
      return undefined;
    case "cancelled":
      return { cancel: true as const };
  }
}

export function notifyFastJevRefusal(
  ui: Pick<ExtensionContext["ui"], "notify">,
  status: FastJevAttemptStatus,
): void {
  if (status.outcome !== "native-fallback") return;
  ui.notify(
    `Fast Jev could not compact (${status.reason ?? "unknown"}); using Pi native compaction.`,
    "warning",
  );
}

export default function fastJevCompaction(
  pi: ExtensionAPI,
  loadConfig: () => FastJevCompactionSettings = readGlobalConfig,
): void {
  let config: FastJevCompactionConfig = { enabled: false };
  let configLoadFailed = false;
  let startupObserved = false;
  let handlerInvocations = 0;
  let lastStatus: FastJevAttemptStatus | undefined;
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("fast-jev-status", {
      description: "Show the last Fast Jev compaction status",
      handler: async (_args, ctx) => {
        const configuration = `configured ${config.enabled ? `enabled${config.phased ? " (phased)" : ""}` : "disabled"}${configLoadFailed ? " (settings load failed)" : ""}; startup observed ${startupObserved ? "yes" : "no"}; compaction handler invocations ${handlerInvocations}`;
        if (lastStatus === undefined) {
          ctx.ui.notify(`Fast Jev compaction has no recorded attempt; ${configuration}.`, "info");
          return;
        }
        const label =
          lastStatus.outcome === "native-fallback" ? "native fallback" : lastStatus.outcome;
        const reason = lastStatus.reason === undefined ? "" : ` (${lastStatus.reason})`;
        const diagnostic = lastStatus.diagnostic;
        const diagnosticText =
          diagnostic === undefined
            ? ""
            : `; ${diagnostic.provider} ${diagnostic.stage}/${diagnostic.reason}${diagnostic.httpStatus === undefined ? "" : ` HTTP ${diagnostic.httpStatus}`}`;
        const selection = lastStatus.selection;
        const selectionText =
          selection === undefined
            ? ""
            : `; ${selection.phase} selection: ${selection.protectedChars} protected chars, ${selection.candidateChars} candidate chars`;
        const tone =
          lastStatus.outcome === "refused" ||
          lastStatus.outcome === "cancelled" ||
          lastStatus.outcome === "native-fallback"
            ? "warning"
            : "info";
        ctx.ui.notify(
          `Fast Jev ${label}${reason}${diagnosticText}: ${lastStatus.beforeChars}→${lastStatus.afterChars} chars${selectionText}; ${lastStatus.totalMs} ms decision time (Jev ${lastStatus.jevMs} ms); ${lastStatus.spans} spans; ${lastStatus.requests} Jev requests; path ${lastStatus.path}; ${configuration}.`,
          tone,
        );
      },
    });
  }
  pi.on("session_start", () => {
    const loaded = loadConfig();
    config = loaded.config;
    configLoadFailed = loaded.loadFailed;
    startupObserved = true;
  });

  // Register synchronously so compaction hooks exist before session startup; disabled mode delegates to Pi.
  const onBeforeCompact = pi.on as unknown as (
    event: "session_before_compact",
    handler: (
      event: SessionBeforeCompactEvent,
      ctx: ExtensionContext,
    ) => Promise<unknown> | unknown,
  ) => void;
  onBeforeCompact("session_before_compact", async (event, ctx) => {
    handlerInvocations += 1;
    if (!config.enabled) {
      ctx.ui.notify("Fast Jev compaction bypassed: jev.compaction is disabled.", "info");
      return undefined;
    }
    const publishStatus = (attempt: FastJevAttemptStatus) => {
      lastStatus = attempt;
      pi.events.emit(FAST_JEV_STATUS_EVENT, attempt);
      notifyFastJevRefusal(ctx.ui, attempt);
    };
    try {
      const result = await runFastJevCompaction(
        event.preparation,
        event.branchEntries,
        {
          modelRegistry: ctx.modelRegistry,
          signal: event.signal,
          onStatus: publishStatus,
          phased: config.phased === true,
        },
        event.customInstructions,
      );
      return toPiCompactionResponse(result);
    } catch {
      const attempt = makeStatus(
        event.signal?.aborted ? "cancelled" : "native-fallback",
        event.signal?.aborted ? "none" : "native",
        event.signal?.aborted ? "caller-cancellation" : "unexpected",
        0,
        0,
        0,
        0,
        0,
        0,
      );
      publishStatus(attempt);
      return event.signal?.aborted ? { cancel: true } : undefined;
    }
  });
}
