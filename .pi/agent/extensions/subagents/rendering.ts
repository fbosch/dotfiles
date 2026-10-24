import type { AssistantMessage, JsonObject, JsonValue, UserMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  getMarkdownTheme,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Markdown,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { isMatching, match, P } from "ts-pattern";
import type { AgentMention } from "../mentions/agent-mentions";
import { paintDockBottomEdge, paintDockRow } from "../prompt-ui/dock-rendering";
import { hexForegroundAnsi } from "../prompt-ui/terminal-color";
import type { ChildObservation } from "./driver";
import {
  inspectable,
  type OpenWorker,
  resultWorkerTarget,
  type WorkerTarget,
  workerTarget,
} from "./interaction";
import type { ToolRendererLookup } from "./main-window-renderers";
import { workerMetadata } from "./metadata";
import type { WorkerSnapshot } from "./owner";
import { singleLine, statusGlyph, terminalText } from "./presentation";

export type AgentAppearance = ReadonlyMap<string, AgentMention>;
export function agentName(name: string, theme: Theme, appearance?: AgentAppearance): string {
  const metadata = appearance?.get(name);
  const label = singleLine(metadata?.displayName ?? name);
  return theme.bold(
    metadata?.color && /^#[\da-f]{6}$/i.test(metadata.color)
      ? `${hexForegroundAnsi(theme, metadata.color)}${label}\u001b[39m`
      : theme.fg("accent", label),
  );
}

export function frameWidget(lines: string[], width: number, theme: Theme): string[] {
  if (!lines.length || width <= 0) return [];
  const inset = width >= 5 ? "  " : "";
  const background = theme.getBgAnsi("toolPendingBg");
  return ["", ...lines.map((line) => inset + line)]
    .map((line) => paintDockRow(line, width, "", background))
    .concat(paintDockBottomEdge(width, "", "", background));
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
type RenderValue = string | Record<string, unknown> | unknown[];
function parse(value: string): RenderValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" || Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? object(parsed)
        : value;
  } catch {
    return value;
  }
}
function preview(value: string, expanded: boolean, theme: Theme): string {
  const lines = terminalText(value).split("\n");
  // Truncation emits ANSI resets even for plain text; strip them to preserve the tool card's background.
  const shown = expanded
    ? lines.slice(0, 50).map((line) => `  ${line}`)
    : [`  ⎿  ${terminalText(truncateToWidth(lines[0] ?? "", 100, "…"))}`];
  if (expanded && lines.length > 50) shown.push("  … /subagents for full evidence");
  return shown.map((line) => theme.fg("dim", line)).join("\n");
}

export function renderCall(
  kind: "launch" | "inspect" | "control",
  args: unknown,
  theme: Theme,
  appearance?: AgentAppearance,
): Component {
  const input = object(args);
  const request = object(input.request);
  const title = match(kind)
    .with("launch", () => agentName(string(input.specialist) || "Subagent", theme, appearance))
    .with("inspect", () => theme.fg("toolTitle", theme.bold("Subagent result")))
    .with("control", () => theme.fg("toolTitle", theme.bold("Subagent control")))
    .exhaustive();
  const detail =
    kind === "launch"
      ? string(input.prompt)
      : [request.mode ?? request.action, request.workerId].filter(Boolean).join(" · ");
  return new Text(
    `▸ ${title}  ${theme.fg("muted", terminalText(truncateToWidth(singleLine(detail), 100, "…")))}`,
    0,
    0,
  );
}

function structuredLines(
  value: unknown,
  expanded: boolean,
  theme: Theme,
  appearance?: AgentAppearance,
  compact = false,
): string {
  if (typeof value === "string") return preview(value, expanded, theme);
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => structuredLines(item, expanded, theme, appearance)).join("\n")
      : theme.fg("dim", "  ⎿  No workers in this parent session");
  const data = object(value);
  if (Array.isArray(data.entries)) {
    const entries = data.entries
      .map((entry) => {
        const row = object(entry);
        return `[${string(row.role)}]\n${string(row.text)}`;
      })
      .join("\n\n");
    return (
      preview(entries || "No transcript entries", expanded, theme) +
      (data.nextOffset === undefined
        ? ""
        : theme.fg("dim", `\n  More transcript entries at offset ${data.nextOffset}`))
    );
  }
  const worker = data.worker === undefined ? data : object(data.worker);
  const assignments = Array.isArray(worker.assignments) ? worker.assignments.map(object) : [];
  const assignment =
    data.assignment === undefined
      ? (assignments.find((item) => item.assignmentId === worker.currentAssignmentId) ?? {})
      : object(data.assignment);
  const state = string(worker.state) || string(data.state);
  const outcome = string(assignment.outcome);
  // Worker lifetime and assignment outcome are distinct: an idle or released child may have failed.
  const status = match({ state, type: data.type })
    .with({ state: P.union("idle", "historical") }, { type: "completion" }, () => outcome || state)
    .otherwise(() => state);
  const label = string(worker.specialist);
  const id = string(worker.workerId) || string(data.workerId);
  const heading = [
    statusGlyph(status, theme, typeof data.activityFrame === "number" ? data.activityFrame : 0),
    !compact && label ? agentName(label, theme, appearance) : "",
    theme.fg("dim", singleLine(status)),
    !compact || expanded ? theme.fg("dim", singleLine(id)) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [heading];
  if (typeof assignment.turnsUsed === "number" && typeof assignment.maxTurns === "number")
    lines.push(theme.fg("dim", `  ↻${assignment.turnsUsed}≤${assignment.maxTurns}`));
  match(data.kind)
    .with("launched", () => {
      const accepted = match(state)
        .with("queued", () => "Queued in background")
        .with("running", () => "Running in background")
        .otherwise(() => "Background assignment accepted");
      lines.push(theme.fg("dim", `  ⎿  ${accepted}`));
    })
    .with("timeout", () => {
      lines.push(theme.fg("warning", "  ⎿  Wait timed out; worker has not been cancelled"));
    })
    .with("interrupted", () => {
      lines.push(theme.fg("warning", "  ⎿  Wait interrupted"));
    })
    .otherwise(() => undefined);
  if (data.type === "update") lines.push(theme.fg("accent", "  update"));
  const question = string(object(data.question ?? worker.question).text);
  const report =
    string(data.report) || string(data.partialReport) || string(data.preview) || string(data.text);
  if (question)
    lines.push(theme.fg("warning", "  Answer needed"), preview(question, expanded, theme));
  if (report) lines.push(preview(report, expanded, theme));
  else if (data.reportAvailable === true)
    lines.push(theme.fg("dim", "  ⎿  Report available · /subagents"));
  if (assignment.error)
    lines.push(theme.fg("error", `  ⎿  ${singleLine(string(assignment.error))}`));
  if (assignment.persistence === "failed" || data.type === "storage-failure")
    lines.push(
      theme.fg(
        "error",
        `  History save failed${assignment.persistenceError ? ": " + singleLine(string(assignment.persistenceError)) : ""}`,
      ),
    );
  if (expanded && assignment.assignmentId)
    lines.push(
      theme.fg(
        "dim",
        `  Assignment: ${singleLine(string(assignment.assignmentId))} · Storage: ${singleLine(string(assignment.persistence))}`,
      ),
    );
  return lines.join("\n");
}

export function renderResult(
  result: { content: readonly { type: string; text?: string }[] },
  options: {
    expanded: boolean;
    isPartial: boolean;
    compact?: boolean;
    open?: OpenWorker | undefined;
    target?: WorkerTarget | undefined;
  },
  theme: Theme,
  appearance?: AgentAppearance,
  reportOnly = false,
): Component {
  const content = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  const target = options.target ?? (reportOnly ? undefined : resultWorkerTarget(result));
  return inspectable(
    new Text(
      structuredLines(
        reportOnly ? content : parse(content),
        options.expanded,
        theme,
        appearance,
        options.compact,
      ),
      0,
      0,
    ),
    () => target,
    options.open,
  );
}

export function renderNotice(
  message: {
    content: string | readonly { type: string; text?: string }[];
    details?: { preview?: string };
  },
  expanded: boolean,
  theme: Theme,
  appearance?: AgentAppearance,
  open?: OpenWorker,
): Component {
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n");
  const data = parse(content);
  return inspectable(
    new Text(
      structuredLines(
        {
          ...object(data),
          ...(message.details?.preview ? { preview: message.details.preview } : {}),
        },
        expanded,
        theme,
        appearance,
      ),
      0,
      0,
    ),
    () => workerTarget(data),
    open,
  );
}

const MAX_TRANSCRIPT_RECORD_CHARS = 1_000_000;
const MAX_TRANSCRIPT_BLOCKS = 256;
const MAX_JSON_NODES = 4_096;
const MAX_JSON_DEPTH = 32;

type TranscriptRecord =
  | { kind: "assistant"; message: AssistantMessage; assistantText: string }
  | { kind: "user"; text: string }
  | ({ kind: "tool" } & DecodedToolResult)
  | {
      kind: "bashExecution";
      command: string;
      output: string;
      exitCode: number | undefined;
      cancelled: boolean;
      fullOutputPath?: string;
      excludeFromContext?: boolean;
    }
  | { kind: "summary"; message: TranscriptSummaryMessage }
  | { kind: "hidden" }
  | { kind: "plain"; text: string; assistantText?: string }
  | { kind: "invalid"; reason: string; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isJsonValue(value: unknown, budget: { nodes: number }, depth = 0): value is JsonValue {
  budget.nodes++;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, budget, depth + 1));
  return (
    isRecord(value) && Object.values(value).every((item) => isJsonValue(item, budget, depth + 1))
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value, { nodes: 0 });
}

function sanitizeJsonValue(value: JsonValue): JsonValue {
  if (typeof value === "string") return terminalText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [terminalText(key), sanitizeJsonValue(item)]),
    );
  }
  return value;
}

function sanitizeJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [terminalText(key), sanitizeJsonValue(item)]),
  );
}

function isAssistantContent(value: unknown): value is AssistantMessage["content"][number] {
  if (!isRecord(value)) return false;
  return match(value)
    .with(
      { type: "text", text: P.string },
      { type: "thinking", thinking: P.string },
      { type: "toolCall", id: P.string, name: P.string, arguments: P.when(isJsonObject) },
      () => true,
    )
    .otherwise(() => false);
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cost)) return false;
  const cost = value.cost;
  const numericFields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
  if (!numericFields.every((field) => finiteNumber(value[field]))) return false;
  if (
    !["input", "output", "cacheRead", "cacheWrite", "total"].every((field) =>
      finiteNumber(cost[field]),
    )
  )
    return false;
  return (
    (value.reasoning === undefined || finiteNumber(value.reasoning)) &&
    (value.cacheWrite1h === undefined || finiteNumber(value.cacheWrite1h))
  );
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return (
    isRecord(value) &&
    value.role === "assistant" &&
    Array.isArray(value.content) &&
    value.content.length <= MAX_TRANSCRIPT_BLOCKS &&
    value.content.every(isAssistantContent) &&
    typeof value.api === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    isUsage(value.usage) &&
    ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(
      String(value.stopReason),
    ) &&
    finiteNumber(value.timestamp) &&
    (value.errorMessage === undefined || typeof value.errorMessage === "string")
  );
}

function sanitizedAssistantMessage(message: AssistantMessage): AssistantMessage {
  const content = message.content.map((block) =>
    match(block)
      .with({ type: "text" }, ({ text }) => ({ type: "text" as const, text: terminalText(text) }))
      .with({ type: "thinking" }, ({ thinking, redacted }) => ({
        type: "thinking" as const,
        thinking: terminalText(thinking),
        ...(redacted === undefined ? {} : { redacted }),
      }))
      .with({ type: "toolCall" }, ({ id, name, arguments: args }) => ({
        type: "toolCall" as const,
        id: terminalText(id),
        name: terminalText(name),
        arguments: sanitizeJsonObject(args),
      }))
      .exhaustive(),
  );
  return {
    role: "assistant",
    content,
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    ...(message.errorMessage === undefined
      ? {}
      : { errorMessage: terminalText(message.errorMessage) }),
  };
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && isMatching({ type: "text", text: P.string }, value);
}

function isImageContent(value: unknown): boolean {
  return (
    isRecord(value) && isMatching({ type: "image", data: P.string, mimeType: P.string }, value)
  );
}

function isUserMessage(value: unknown): value is UserMessage {
  return (
    isRecord(value) &&
    value.role === "user" &&
    (typeof value.content === "string" ||
      (Array.isArray(value.content) &&
        value.content.length <= MAX_TRANSCRIPT_BLOCKS &&
        value.content.every((block) => isTextContent(block) || isImageContent(block)))) &&
    finiteNumber(value.timestamp)
  );
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return terminalText(message.content);
  return message.content
    .map((block) =>
      match(block)
        .with({ type: "text" }, ({ text }) => terminalText(text))
        .with({ type: "image" }, () => "[Image content omitted]")
        .exhaustive(),
    )
    .join("\n");
}

function isSystemMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.role === "system" &&
    (typeof value.content === "string" ||
      (Array.isArray(value.content) &&
        value.content.length <= MAX_TRANSCRIPT_BLOCKS &&
        value.content.every(isTextContent))) &&
    finiteNumber(value.timestamp)
  );
}

interface DecodedToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: { type: "text"; text: string }[];
  readonly isError: boolean;
  readonly details?: unknown;
}

function decodeToolResult(value: unknown): DecodedToolResult | undefined {
  if (
    !isRecord(value) ||
    value.role !== "toolResult" ||
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string" ||
    !Array.isArray(value.content) ||
    value.content.length > MAX_TRANSCRIPT_BLOCKS ||
    typeof value.isError !== "boolean" ||
    !finiteNumber(value.timestamp) ||
    !value.content.every((block) => isTextContent(block) || isImageContent(block))
  )
    return undefined;
  if (value.details !== undefined && !isJsonValue(value.details, { nodes: 0 })) return undefined;
  const content = value.content.map((block) =>
    isTextContent(block)
      ? { type: "text" as const, text: terminalText(block.text) }
      : { type: "text" as const, text: "[Image content omitted]" },
  );
  return {
    toolCallId: terminalText(value.toolCallId),
    toolName: terminalText(value.toolName),
    content,
    isError: value.isError,
    details: value.details === undefined ? undefined : sanitizeJsonValue(value.details),
  };
}

type TranscriptSummaryMessage =
  | { role: "branchSummary"; summary: string; fromId: string | null; timestamp: number }
  | { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number };

function isCustomMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.role === "custom" &&
    typeof value.customType === "string" &&
    (typeof value.content === "string" ||
      (Array.isArray(value.content) &&
        value.content.length <= MAX_TRANSCRIPT_BLOCKS &&
        value.content.every((block) => isTextContent(block) || isImageContent(block)))) &&
    typeof value.display === "boolean" &&
    finiteNumber(value.timestamp)
  );
}

function decodeBashExecution(
  value: unknown,
): Extract<TranscriptRecord, { kind: "bashExecution" }> | undefined {
  if (
    !isRecord(value) ||
    value.role !== "bashExecution" ||
    typeof value.command !== "string" ||
    typeof value.output !== "string" ||
    (value.exitCode !== undefined && !finiteNumber(value.exitCode)) ||
    typeof value.cancelled !== "boolean" ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean") ||
    (value.fullOutputPath !== undefined && typeof value.fullOutputPath !== "string") ||
    (value.excludeFromContext !== undefined && typeof value.excludeFromContext !== "boolean") ||
    !finiteNumber(value.timestamp)
  )
    return undefined;
  return {
    kind: "bashExecution",
    command: terminalText(value.command),
    output: terminalText(value.output),
    exitCode: value.exitCode,
    cancelled: value.cancelled,
    ...(value.fullOutputPath === undefined
      ? {}
      : { fullOutputPath: terminalText(value.fullOutputPath) }),
    ...(value.excludeFromContext === undefined
      ? {}
      : { excludeFromContext: value.excludeFromContext }),
  };
}

function decodeSummary(value: unknown): Extract<TranscriptRecord, { kind: "summary" }> | undefined {
  if (!isRecord(value)) return undefined;
  return match(value)
    .returnType<Extract<TranscriptRecord, { kind: "summary" }> | undefined>()
    .with(
      {
        role: "branchSummary",
        summary: P.string,
        fromId: P.union(P.string, null),
        timestamp: P.number.finite(),
      },
      ({ summary, fromId, timestamp }) => ({
        kind: "summary",
        message: {
          role: "branchSummary",
          summary: terminalText(summary),
          fromId: fromId === null ? null : terminalText(fromId),
          timestamp,
        },
      }),
    )
    .with(
      {
        role: "compactionSummary",
        summary: P.string,
        tokensBefore: P.number.finite(),
        timestamp: P.number.finite(),
      },
      ({ summary, tokensBefore, timestamp }) => ({
        kind: "summary",
        message: {
          role: "compactionSummary",
          summary: terminalText(summary),
          tokensBefore,
          timestamp,
        },
      }),
    )
    .otherwise(() => undefined);
}

const INTERNAL_SYSTEM_ROLES = new Set(["custom"]);

function decodeTranscriptEntry(entry: { role: string; text: string }): TranscriptRecord {
  const plain = (): TranscriptRecord => ({
    kind: "plain",
    text: entry.text,
    ...(entry.role === "assistant" ? { assistantText: entry.text } : {}),
  });
  const invalid = (reason: string): TranscriptRecord => ({
    kind: "invalid",
    reason: `${reason}; raw saved evidence follows`,
    text: entry.text,
  });
  if (entry.text.length > MAX_TRANSCRIPT_RECORD_CHARS)
    return invalid("serialized message exceeds the decode limit");
  if (!entry.text.trimStart().startsWith("{")) return plain();

  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.text) as unknown;
  } catch {
    return entry.text.includes('"role"') ? invalid("malformed serialized message") : plain();
  }
  if (!isRecord(parsed) || !("role" in parsed)) return plain();
  if (typeof parsed.role !== "string") return invalid("message role is not a string");
  if (entry.role === "system") {
    const system = match(parsed.role)
      .returnType<TranscriptRecord | undefined>()
      .with(
        "bashExecution",
        () => decodeBashExecution(parsed) ?? invalid("invalid bash execution message"),
      )
      .with(
        "branchSummary",
        "compactionSummary",
        () => decodeSummary(parsed) ?? invalid("invalid transcript summary"),
      )
      .otherwise(() => undefined);
    if (system) return system;
  }

  const expectedRole = entry.role === "tool" ? "toolResult" : entry.role;
  if (parsed.role !== expectedRole) {
    if (
      entry.role === "system" &&
      INTERNAL_SYSTEM_ROLES.has(parsed.role) &&
      isCustomMessage(parsed)
    )
      return { kind: "hidden" };
    const known = [
      "system",
      "user",
      "assistant",
      "toolResult",
      "bashExecution",
      "branchSummary",
      "compactionSummary",
      ...INTERNAL_SYSTEM_ROLES,
    ];
    const reason = known.includes(parsed.role)
      ? `expected ${expectedRole}, found ${parsed.role}`
      : `unknown message role ${singleLine(parsed.role)}`;
    return invalid(reason);
  }

  return match(parsed.role)
    .returnType<TranscriptRecord>()
    .with("system", () =>
      isSystemMessage(parsed) ? { kind: "hidden" } : invalid("invalid system envelope"),
    )
    .with("user", () =>
      isUserMessage(parsed)
        ? { kind: "user", text: userText(parsed) }
        : invalid("invalid user message envelope"),
    )
    .with("assistant", () => {
      if (!isAssistantMessage(parsed)) return invalid("invalid assistant message envelope");
      const assistantText = parsed.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return { kind: "assistant", message: sanitizedAssistantMessage(parsed), assistantText };
    })
    .with("toolResult", () => {
      const result = decodeToolResult(parsed);
      return result ? { kind: "tool", ...result } : invalid("invalid tool result envelope");
    })
    .otherwise((role) => invalid(`unsupported message role ${singleLine(role)}`));
}

export function workerTranscript(
  worker: WorkerSnapshot,
  observation: ChildObservation | undefined,
  theme: Theme,
  options:
    | { tui: TUI; cwd: string; getToolRenderers?: ToolRendererLookup | undefined }
    | undefined = undefined,
  metadataExpanded = false,
): Component {
  let building = true;
  // Replaying lifecycle flags must not schedule another render while this view
  // is being rebuilt. Later renderer invalidations still reach the real TUI.
  if (options) {
    const tui = options.tui;
    options = {
      ...options,
      tui: new Proxy(tui, {
        get(target, key, receiver) {
          if (key !== "requestRender") return Reflect.get(target, key, receiver);
          return (...args: Parameters<TUI["requestRender"]>) => {
            if (!building) tui.requestRender(...args);
          };
        },
      }),
    };
  }
  const body = new Container();
  const text = (value: string) => body.addChild(new Text(terminalText(value), 0, 0));
  const markdown = (value: string) =>
    body.addChild(new Markdown(terminalText(value), 0, 0, getMarkdownTheme()));
  const metadata = workerMetadata(worker, observation, metadataExpanded);
  metadata.forEach((line, index) => {
    body.addChild(new Text(index === 0 ? theme.bold(line) : theme.fg("muted", line), 0, 0));
  });
  body.addChild(
    new Text(theme.fg("dim", "\nReports are worker evidence, not verified conclusions."), 0, 0),
  );
  for (const assignment of worker.assignments) {
    body.addChild(
      new Text(theme.fg("borderMuted", `\n── Assignment ${singleLine(assignment.id)} ──`), 0, 0),
    );
    text(
      `Execution: ${assignment.outcome} | Storage: ${assignment.persistence} | ↻${assignment.turnsUsed}≤${assignment.maxTurns}`,
    );
    if (assignment.error) text(`Execution error: ${assignment.error}`);
    if (assignment.persistenceError) text(`Storage error: ${assignment.persistenceError}`);

    let hasTranscriptContent = false;
    const pendingTools = new Map<string, ToolExecutionComponent>();
    const fallbackToolCalls = new Map<string, string>();
    const assistantTexts = new Set<string>();
    const beforeMessage = () => {
      if (hasTranscriptContent) body.addChild(new Spacer(1));
      hasTranscriptContent = true;
    };

    const renderAssistant = (decoded: Extract<TranscriptRecord, { kind: "assistant" }>): void => {
      assistantTexts.add(decoded.assistantText);
      beforeMessage();
      body.addChild(new AssistantMessageComponent(decoded.message, false, getMarkdownTheme()));
      for (const call of decoded.message.content) {
        if (call.type !== "toolCall") continue;
        const name = terminalText(call.name);
        const id = terminalText(call.id);
        const args = sanitizeJsonObject(call.arguments);
        if (options) {
          const tool = new ToolExecutionComponent(
            name,
            id,
            args,
            { showImages: false },
            options.getToolRenderers?.(name),
            options.tui,
            options.cwd,
          );
          tool.setExpanded(true);
          tool.setArgsComplete();
          body.addChild(tool);
          if (decoded.message.stopReason === "error" || decoded.message.stopReason === "aborted") {
            tool.updateResult({
              content: [
                {
                  type: "text",
                  text: terminalText(
                    decoded.message.errorMessage ?? "Assistant call ended before tool execution",
                  ),
                },
              ],
              isError: true,
            });
          } else {
            pendingTools.set(id, tool);
          }
        } else {
          text(`▸ ${singleLine(name)} ${JSON.stringify(args)}`);
          fallbackToolCalls.set(id, name);
        }
      }
    };

    const renderTool = (decoded: Extract<TranscriptRecord, { kind: "tool" }>): void => {
      const fallbackName = fallbackToolCalls.get(decoded.toolCallId);
      fallbackToolCalls.delete(decoded.toolCallId);
      const pending = pendingTools.get(decoded.toolCallId);
      if (pending) {
        pending.markExecutionStarted();
        pending.updateResult({
          content: decoded.content,
          isError: decoded.isError,
          details: decoded.details,
        });
        pendingTools.delete(decoded.toolCallId);
      } else {
        beforeMessage();
        const resultLabel = fallbackName
          ? `▸ ${singleLine(fallbackName)} result`
          : `▸ ${singleLine(decoded.toolName)} · unmatched tool result ${singleLine(decoded.toolCallId)}`;
        body.addChild(new Text(theme.fg(decoded.isError ? "error" : "accent", resultLabel), 0, 0));
        markdown(
          decoded.content.map((block) => block.text).join("\n") ||
            (decoded.isError ? "Tool failed without text output" : "Tool returned no text output"),
        );
      }
    };

    const renderBash = (decoded: Extract<TranscriptRecord, { kind: "bashExecution" }>): void => {
      beforeMessage();
      if (options) {
        const bash = new BashExecutionComponent(
          decoded.command,
          options.tui,
          decoded.excludeFromContext ?? false,
        );
        if (decoded.output) bash.appendOutput(decoded.output);
        bash.setComplete(decoded.exitCode, decoded.cancelled, undefined, decoded.fullOutputPath);
        body.addChild(bash);
      } else {
        text(`$ ${decoded.command}`);
        if (decoded.output) text(decoded.output);
      }
    };

    const renderSummary = (decoded: Extract<TranscriptRecord, { kind: "summary" }>): void => {
      beforeMessage();
      body.addChild(new Spacer(1));
      const summary = match(decoded.message)
        .with(
          { role: "branchSummary" },
          (message) => new BranchSummaryMessageComponent(message, getMarkdownTheme()),
        )
        .with(
          { role: "compactionSummary" },
          (message) => new CompactionSummaryMessageComponent(message, getMarkdownTheme()),
        )
        .exhaustive();
      summary.setExpanded(true);
      body.addChild(summary);
    };

    const renderPlain = (
      decoded: Extract<TranscriptRecord, { kind: "plain" }>,
      role: string,
    ): void => {
      if (decoded.assistantText !== undefined) assistantTexts.add(decoded.assistantText);
      beforeMessage();
      const heading = match(role)
        .with("system", () => theme.fg("dim", "\n── System notice ──"))
        .with("tool", () => theme.fg("accent", "\n▸ Tool result · raw transcript"))
        .otherwise(() => theme.fg("muted", `\n── ${singleLine(role)} message ──`));
      body.addChild(new Text(heading, 0, 0));
      markdown(decoded.text);
    };

    for (const entry of assignment.transcript) {
      match(decodeTranscriptEntry(entry))
        .with({ kind: "hidden" }, () => undefined)
        .with({ kind: "assistant" }, renderAssistant)
        .with({ kind: "user" }, ({ text }) => {
          beforeMessage();
          if (text) body.addChild(new UserMessageComponent(text, getMarkdownTheme()));
        })
        .with({ kind: "tool" }, renderTool)
        .with({ kind: "bashExecution" }, renderBash)
        .with({ kind: "summary" }, renderSummary)
        .with({ kind: "plain" }, (decoded) => renderPlain(decoded, entry.role))
        .with({ kind: "invalid" }, ({ text: raw }) => {
          beforeMessage();
          body.addChild(
            new Text(
              theme.fg(
                "warning",
                "\nTranscript entry could not be displayed; the original entry follows.",
              ),
              0,
              0,
            ),
          );
          text(raw);
        })
        .exhaustive();
    }

    if (assignment.report !== undefined && !assistantTexts.has(assignment.report)) {
      text("\nFinal report");
      markdown(assignment.report);
    }
    if (assignment.partialReport !== undefined && !assistantTexts.has(assignment.partialReport)) {
      text("\nPartial report");
      markdown(assignment.partialReport);
    }
  }
  if (worker.pendingQuestion) {
    text("\nAnswer needed");
    markdown(worker.pendingQuestion.text);
  }
  if (observation?.liveText && worker.status === "running") {
    text("\n◍ Streaming output");
    markdown(observation.liveText);
  }
  building = false;
  return body;
}
