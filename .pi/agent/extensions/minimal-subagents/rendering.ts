import { AssistantMessageComponent, BashExecutionComponent, BranchSummaryMessageComponent, CompactionSummaryMessageComponent, getMarkdownTheme, ToolExecutionComponent, UserMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { ToolRendererLookup } from "./main-window-renderers";
import type { AgentMention } from "../mentions/agent-mentions";
import { paintDockBottomEdge, paintDockRow } from "../prompt-ui/dock-rendering";
import { hexForegroundAnsi } from "../prompt-ui/terminal-color";
import type { ChildObservation } from "./driver";
import type { WorkerSnapshot } from "./owner";
import { singleLine, statusGlyph, terminalText, workerDetails } from "./presentation";
import { inspectable, resultWorkerTarget, workerTarget, type OpenWorker, type WorkerTarget } from "./interaction";
import type { AssistantMessage, JsonObject, JsonValue, UserMessage } from "@earendil-works/pi-ai";

export type AgentAppearance = ReadonlyMap<string, AgentMention>;
export function agentName(name: string, theme: Theme, appearance?: AgentAppearance): string {
  const metadata = appearance?.get(name);
  const label = singleLine(metadata?.displayName ?? name);
  return theme.bold(metadata?.color && /^#[\da-f]{6}$/i.test(metadata.color)
    ? `${hexForegroundAnsi(theme, metadata.color)}${label}\u001b[39m`
    : theme.fg("accent", label));
}

export function frameWidget(lines: string[], width: number, theme: Theme): string[] {
  if (!lines.length || width <= 0) return [];
  const inset = width >= 5 ? "  " : "";
  const background = theme.getBgAnsi("toolPendingBg");
  return ["", ...lines.map((line) => inset + line)].map((line) => paintDockRow(line, width, "", background))
    .concat(paintDockBottomEdge(width, "", "", background));
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
type RenderValue = string | Record<string, unknown> | unknown[];
function parse(value: string): RenderValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" || Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? object(parsed) : value;
  } catch { return value; }
}
function preview(value: string, expanded: boolean, theme: Theme): string {
  const lines = terminalText(value).split("\n");
  // Truncation emits ANSI resets even for plain text; strip them to preserve the tool card's background.
  const shown = expanded ? lines.slice(0, 50).map((line) => `  ${line}`) : [`  ⎿  ${terminalText(truncateToWidth(lines[0] ?? "", 100, "…"))}`];
  if (expanded && lines.length > 50) shown.push("  … /subagents for full evidence");
  return shown.map((line) => theme.fg("dim", line)).join("\n");
}

export function renderCall(kind: "launch" | "inspect" | "control", args: unknown, theme: Theme, appearance?: AgentAppearance): Component {
  const input = object(args);
  const request = object(input.request);
  const title = kind === "launch" ? agentName(string(input.specialist) || "Subagent", theme, appearance)
    : theme.fg("toolTitle", theme.bold(kind === "inspect" ? "Subagent result" : "Subagent control"));
  const detail = kind === "launch" ? string(input.prompt) : [request.mode ?? request.action, request.workerId].filter(Boolean).join(" · ");
  return new Text(`▸ ${title}  ${theme.fg("muted", terminalText(truncateToWidth(singleLine(detail), 100, "…")))}`, 0, 0);
}

function structuredLines(value: unknown, expanded: boolean, theme: Theme, appearance?: AgentAppearance, compact = false): string {
  if (typeof value === "string") return preview(value, expanded, theme);
  if (Array.isArray(value)) return value.length ? value.map((item) => structuredLines(item, expanded, theme, appearance)).join("\n") : theme.fg("dim", "  ⎿  No workers in this parent session");
  const data = object(value);
  if (Array.isArray(data.entries)) {
    const entries = data.entries.map((entry) => { const row = object(entry); return `[${string(row.role)}]\n${string(row.text)}`; }).join("\n\n");
    return preview(entries || "No transcript entries", expanded, theme) + (data.nextOffset === undefined ? "" : theme.fg("dim", `\n  More transcript entries at offset ${data.nextOffset}`));
  }
  const worker = data.worker === undefined ? data : object(data.worker);
  const assignments = Array.isArray(worker.assignments) ? worker.assignments.map(object) : [];
  const assignment = data.assignment === undefined ? assignments.find((item) => item.assignmentId === worker.currentAssignmentId) ?? {} : object(data.assignment);
  const state = string(worker.state) || string(data.state);
  const outcome = string(assignment.outcome);
  // Worker lifetime and assignment outcome are distinct: an idle or released child may have failed.
  const status = state === "idle" || state === "historical" || data.type === "completion" ? outcome || state : state;
  const label = string(worker.specialist);
  const id = string(worker.workerId) || string(data.workerId);
  const heading = [statusGlyph(status, theme), !compact && label ? agentName(label, theme, appearance) : "", theme.fg("dim", singleLine(status)), !compact || expanded ? theme.fg("dim", singleLine(id)) : ""].filter(Boolean).join(" ");
  const lines = [heading];
  if (typeof assignment.turnsUsed === "number" && typeof assignment.maxTurns === "number") lines.push(theme.fg("dim", `  ↻${assignment.turnsUsed}≤${assignment.maxTurns}`));
  if (data.kind === "launched") lines.push(theme.fg("dim", `  ⎿  ${state === "queued" ? "Queued in background" : state === "running" ? "Running in background" : "Background assignment accepted"}`));
  if (data.kind === "timeout") lines.push(theme.fg("warning", "  ⎿  Wait timed out; worker has not been cancelled"));
  if (data.kind === "interrupted") lines.push(theme.fg("warning", "  ⎿  Wait interrupted"));
  if (data.type === "update") lines.push(theme.fg("accent", "  update"));
  const question = string(object(data.question ?? worker.question).text);
  const report = string(data.report) || string(data.partialReport) || string(data.preview) || string(data.text);
  if (question) lines.push(theme.fg("warning", "  Answer needed"), preview(question, expanded, theme));
  if (report) lines.push(preview(report, expanded, theme));
  else if (data.reportAvailable === true) lines.push(theme.fg("dim", "  ⎿  Report available · /subagents"));
  if (assignment.error) lines.push(theme.fg("error", `  ⎿  ${singleLine(string(assignment.error))}`));
  if (assignment.persistence === "failed" || data.type === "storage-failure") lines.push(theme.fg("error", `  History save failed${assignment.persistenceError ? ": " + singleLine(string(assignment.persistenceError)) : ""}`));
  if (expanded && assignment.assignmentId) lines.push(theme.fg("dim", `  Assignment: ${singleLine(string(assignment.assignmentId))} · Storage: ${singleLine(string(assignment.persistence))}`));
  return lines.join("\n");
}

export function renderResult(result: { content: readonly { type: string; text?: string }[] }, options: { expanded: boolean; isPartial: boolean; compact?: boolean; open?: OpenWorker | undefined; target?: WorkerTarget | undefined }, theme: Theme, appearance?: AgentAppearance, reportOnly = false): Component {
  const content = result.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  const target = options.target ?? (reportOnly ? undefined : resultWorkerTarget(result));
  return inspectable(new Text(structuredLines(reportOnly ? content : parse(content), options.expanded, theme, appearance, options.compact), 0, 0), () => target, options.open);
}

export function renderNotice(message: { content: string | readonly { type: string; text?: string }[]; details?: { preview?: string } }, expanded: boolean, theme: Theme, appearance?: AgentAppearance, open?: OpenWorker): Component {
  const content = typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  const data = parse(content);
  return inspectable(new Text(structuredLines({ ...object(data), ...(message.details?.preview ? { preview: message.details.preview } : {}) }, expanded, theme, appearance), 0, 0), () => workerTarget(data), open);
}

const MAX_TRANSCRIPT_RECORD_CHARS = 1_000_000;
const MAX_TRANSCRIPT_BLOCKS = 256;
const MAX_JSON_NODES = 4_096;
const MAX_JSON_DEPTH = 32;

type TranscriptRecord =
  | { kind: "assistant"; message: AssistantMessage; assistantText: string }
  | { kind: "user"; text: string }
  | ({ kind: "tool" } & DecodedToolResult)
  | { kind: "bashExecution"; command: string; output: string; exitCode: number | undefined; cancelled: boolean; fullOutputPath?: string; excludeFromContext?: boolean }
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
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, budget, depth + 1));
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value, { nodes: 0 });
}

function sanitizeJsonValue(value: JsonValue): JsonValue {
  if (typeof value === "string") return terminalText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [terminalText(key), sanitizeJsonValue(item)]));
  }
  return value;
}

function sanitizeJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [terminalText(key), sanitizeJsonValue(item)]));
}

function isAssistantContent(value: unknown): value is AssistantMessage["content"][number] {
  if (!isRecord(value)) return false;
  if (value.type === "text" || value.type === "thinking") {
    return typeof (value.type === "text" ? value.text : value.thinking) === "string";
  }
  return value.type === "toolCall"
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isJsonObject(value.arguments);
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cost)) return false;
  const cost = value.cost;
  const numericFields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
  if (!numericFields.every((field) => finiteNumber(value[field]))) return false;
  if (!["input", "output", "cacheRead", "cacheWrite", "total"].every((field) => finiteNumber(cost[field]))) return false;
  return (value.reasoning === undefined || finiteNumber(value.reasoning))
    && (value.cacheWrite1h === undefined || finiteNumber(value.cacheWrite1h));
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && Array.isArray(value.content)
    && value.content.length <= MAX_TRANSCRIPT_BLOCKS
    && value.content.every(isAssistantContent)
    && typeof value.api === "string"
    && typeof value.provider === "string"
    && typeof value.model === "string"
    && isUsage(value.usage)
    && ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(String(value.stopReason))
    && finiteNumber(value.timestamp)
    && (value.errorMessage === undefined || typeof value.errorMessage === "string");
}

function sanitizedAssistantMessage(message: AssistantMessage): AssistantMessage {
  const content = message.content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: terminalText(block.text) };
    if (block.type === "thinking") return { type: "thinking" as const, thinking: terminalText(block.thinking), ...(block.redacted === undefined ? {} : { redacted: block.redacted }) };
    return { type: "toolCall" as const, id: terminalText(block.id), name: terminalText(block.name), arguments: sanitizeJsonObject(block.arguments) };
  });
  return {
    role: "assistant",
    content,
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    ...(message.errorMessage === undefined ? {} : { errorMessage: terminalText(message.errorMessage) }),
  };
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isImageContent(value: unknown): boolean {
  return isRecord(value) && value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string";
}

function isUserMessage(value: unknown): value is UserMessage {
  return isRecord(value)
    && value.role === "user"
    && (typeof value.content === "string"
      || (Array.isArray(value.content) && value.content.length <= MAX_TRANSCRIPT_BLOCKS && value.content.every((block) => isTextContent(block) || isImageContent(block))))
    && finiteNumber(value.timestamp);
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return terminalText(message.content);
  return message.content.map((block) => block.type === "text" ? terminalText(block.text) : "[Image content omitted]").join("\n");
}

function isSystemMessage(value: unknown): boolean {
  return isRecord(value)
    && value.role === "system"
    && (typeof value.content === "string"
      || (Array.isArray(value.content) && value.content.length <= MAX_TRANSCRIPT_BLOCKS && value.content.every(isTextContent)))
    && finiteNumber(value.timestamp);
}

interface DecodedToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: { type: "text"; text: string }[];
  readonly isError: boolean;
  readonly details?: unknown;
}

function decodeToolResult(value: unknown): DecodedToolResult | undefined {
  if (!isRecord(value) || value.role !== "toolResult" || typeof value.toolCallId !== "string"
    || typeof value.toolName !== "string" || !Array.isArray(value.content)
    || value.content.length > MAX_TRANSCRIPT_BLOCKS || typeof value.isError !== "boolean" || !finiteNumber(value.timestamp)
    || !value.content.every((block) => isTextContent(block) || isImageContent(block))) return undefined;
  if (value.details !== undefined && !isJsonValue(value.details, { nodes: 0 })) return undefined;
  const content = value.content.map((block) => isTextContent(block)
    ? { type: "text" as const, text: terminalText(block.text) }
    : { type: "text" as const, text: "[Image content omitted]" });
  return { toolCallId: terminalText(value.toolCallId), toolName: terminalText(value.toolName), content, isError: value.isError, details: value.details === undefined ? undefined : sanitizeJsonValue(value.details) };
}

type TranscriptSummaryMessage =
  | { role: "branchSummary"; summary: string; fromId: string | null; timestamp: number }
  | { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number };

function isCustomMessage(value: unknown): boolean {
  return isRecord(value)
    && value.role === "custom"
    && typeof value.customType === "string"
    && (typeof value.content === "string"
      || (Array.isArray(value.content) && value.content.length <= MAX_TRANSCRIPT_BLOCKS
        && value.content.every((block) => isTextContent(block) || isImageContent(block))))
    && typeof value.display === "boolean"
    && finiteNumber(value.timestamp);
}

function decodeBashExecution(value: unknown): Extract<TranscriptRecord, { kind: "bashExecution" }> | undefined {
  if (!isRecord(value) || value.role !== "bashExecution" || typeof value.command !== "string"
    || typeof value.output !== "string" || (value.exitCode !== undefined && !finiteNumber(value.exitCode))
    || typeof value.cancelled !== "boolean" || (value.truncated !== undefined && typeof value.truncated !== "boolean")
    || (value.fullOutputPath !== undefined && typeof value.fullOutputPath !== "string")
    || (value.excludeFromContext !== undefined && typeof value.excludeFromContext !== "boolean")
    || !finiteNumber(value.timestamp)) return undefined;
  return {
    kind: "bashExecution",
    command: terminalText(value.command),
    output: terminalText(value.output),
    exitCode: value.exitCode,
    cancelled: value.cancelled,
    ...(value.fullOutputPath === undefined ? {} : { fullOutputPath: terminalText(value.fullOutputPath) }),
    ...(value.excludeFromContext === undefined ? {} : { excludeFromContext: value.excludeFromContext }),
  };
}

function decodeSummary(value: unknown): Extract<TranscriptRecord, { kind: "summary" }> | undefined {
  if (!isRecord(value) || typeof value.summary !== "string" || !finiteNumber(value.timestamp)) return undefined;
  if (value.role === "branchSummary" && (typeof value.fromId === "string" || value.fromId === null)) {
    return { kind: "summary", message: { role: "branchSummary", summary: terminalText(value.summary), fromId: value.fromId === null ? null : terminalText(value.fromId), timestamp: value.timestamp } };
  }
  if (value.role === "compactionSummary" && finiteNumber(value.tokensBefore)) {
    return { kind: "summary", message: { role: "compactionSummary", summary: terminalText(value.summary), tokensBefore: value.tokensBefore, timestamp: value.timestamp } };
  }
  return undefined;
}

const INTERNAL_SYSTEM_ROLES = new Set(["custom"]);

function decodeTranscriptEntry(entry: { role: string; text: string }): TranscriptRecord {
  const plain = (): TranscriptRecord => ({
    kind: "plain",
    text: entry.text,
    ...(entry.role === "assistant" ? { assistantText: entry.text } : {}),
  });
  if (entry.text.length > MAX_TRANSCRIPT_RECORD_CHARS) {
    return { kind: "invalid", reason: "serialized message exceeds the decode limit; raw saved evidence follows", text: entry.text };
  }
  if (!entry.text.trimStart().startsWith("{")) return plain();

  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.text) as unknown;
  } catch {
    return entry.text.includes('"role"')
      ? { kind: "invalid", reason: "malformed serialized message; raw saved evidence follows", text: entry.text }
      : plain();
  }
  if (!isRecord(parsed) || !("role" in parsed)) return plain();
  if (typeof parsed.role !== "string") return { kind: "invalid", reason: "message role is not a string; raw saved evidence follows", text: entry.text };
  if (entry.role === "system") {
    if (parsed.role === "bashExecution") {
      return decodeBashExecution(parsed)
        ?? { kind: "invalid", reason: "invalid bash execution message; raw saved evidence follows", text: entry.text };
    }
    if (parsed.role === "branchSummary" || parsed.role === "compactionSummary") {
      return decodeSummary(parsed)
        ?? { kind: "invalid", reason: "invalid transcript summary; raw saved evidence follows", text: entry.text };
    }
  }


  const expectedRole = entry.role === "tool" ? "toolResult" : entry.role;
  if (parsed.role !== expectedRole) {
    if (entry.role === "system" && INTERNAL_SYSTEM_ROLES.has(parsed.role) && isCustomMessage(parsed)) return { kind: "hidden" };
    if (entry.role === "system" && parsed.role === "system" && isSystemMessage(parsed)) return { kind: "hidden" };
    const known = ["system", "user", "assistant", "toolResult", "bashExecution", "branchSummary", "compactionSummary", ...INTERNAL_SYSTEM_ROLES];
    const reason = known.includes(parsed.role) ? `expected ${expectedRole}, found ${parsed.role}` : `unknown message role ${singleLine(parsed.role)}`;
    return { kind: "invalid", reason: `${reason}; raw saved evidence follows`, text: entry.text };
  }

  if (parsed.role === "system") {
    return isSystemMessage(parsed)
      ? { kind: "hidden" }
      : { kind: "invalid", reason: "invalid system envelope; raw saved evidence follows", text: entry.text };
  }
  if (parsed.role === "user") {
    return isUserMessage(parsed)
      ? { kind: "user", text: userText(parsed) }
      : { kind: "invalid", reason: "invalid user message envelope; raw saved evidence follows", text: entry.text };
  }
  if (parsed.role === "assistant") {
    if (!isAssistantMessage(parsed)) return { kind: "invalid", reason: "invalid assistant message envelope; raw saved evidence follows", text: entry.text };
    const assistantText = parsed.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    return { kind: "assistant", message: sanitizedAssistantMessage(parsed), assistantText };
  }
  if (parsed.role === "toolResult") {
    const result = decodeToolResult(parsed);
    return result ? { kind: "tool", ...result } : { kind: "invalid", reason: "invalid tool result envelope; raw saved evidence follows", text: entry.text };
  }
  return { kind: "invalid", reason: `unsupported message role ${singleLine(parsed.role)}; raw saved evidence follows`, text: entry.text };
}

export function workerTranscript(worker: WorkerSnapshot, observation: ChildObservation | undefined, theme: Theme, options: { tui: TUI; cwd: string; getToolRenderers?: ToolRendererLookup | undefined } | undefined = undefined): Component {
  let building = true;
  // Replaying lifecycle flags must not schedule another render while this view
  // is being rebuilt. Later renderer invalidations still reach the real TUI.
  if (options) {
    const tui = options.tui;
    options = { ...options, tui: new Proxy(tui, {
      get(target, key, receiver) {
        if (key !== "requestRender") return Reflect.get(target, key, receiver);
        return (...args: Parameters<TUI["requestRender"]>) => { if (!building) tui.requestRender(...args); };
      },
    }) };
  }
  const body = new Container();
  const text = (value: string) => body.addChild(new Text(terminalText(value), 0, 0));
  const markdown = (value: string) => body.addChild(new Markdown(terminalText(value), 0, 0, getMarkdownTheme()));
  const { pendingQuestion: _question, ...metadata } = worker;
  text(workerDetails({ ...metadata, assignments: [] }, observation ? { ...observation, liveText: "" } : undefined));
  for (const assignment of worker.assignments) {
    body.addChild(new Text(theme.fg("borderMuted", `\n── Assignment ${singleLine(assignment.id)} ──`), 0, 0));
    text(`Execution: ${assignment.outcome} | Storage: ${assignment.persistence} | ↻${assignment.turnsUsed}≤${assignment.maxTurns}`);
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

    for (const entry of assignment.transcript) {
      const decoded = decodeTranscriptEntry(entry);
      if (decoded.kind === "hidden") continue;
      if ((decoded.kind === "assistant" || decoded.kind === "plain") && decoded.assistantText !== undefined) assistantTexts.add(decoded.assistantText);

      if (decoded.kind === "assistant") {
        beforeMessage();
        body.addChild(new AssistantMessageComponent(decoded.message, false, getMarkdownTheme()));
        for (const call of decoded.message.content) {
          if (call.type !== "toolCall") continue;
          const name = terminalText(call.name);
          const id = terminalText(call.id);
          const args = sanitizeJsonObject(call.arguments);
          if (options) {
            const tool = new ToolExecutionComponent(name, id, args, { showImages: false }, options.getToolRenderers?.(name), options.tui, options.cwd);
            tool.setExpanded(true);
            tool.setArgsComplete();
            body.addChild(tool);
            if (decoded.message.stopReason === "error" || decoded.message.stopReason === "aborted") {
              tool.updateResult({ content: [{ type: "text", text: terminalText(decoded.message.errorMessage ?? "Assistant call ended before tool execution") }], isError: true });
            } else {
              pendingTools.set(id, tool);
            }
          } else {
            text(`▸ ${singleLine(name)} ${JSON.stringify(args)}`);
            fallbackToolCalls.set(id, name);
          }
        }
        continue;
      }

      if (decoded.kind === "user") {
        beforeMessage();
        if (decoded.text) body.addChild(new UserMessageComponent(decoded.text, getMarkdownTheme()));
        continue;
      }

      if (decoded.kind === "tool") {
        const fallbackName = fallbackToolCalls.get(decoded.toolCallId);
        fallbackToolCalls.delete(decoded.toolCallId);
        const pending = pendingTools.get(decoded.toolCallId);
        if (pending) {
          pending.markExecutionStarted();
          pending.updateResult({ content: decoded.content, isError: decoded.isError, details: decoded.details });
          pendingTools.delete(decoded.toolCallId);
        } else {
          beforeMessage();
          const resultLabel = fallbackName ? `▸ ${singleLine(fallbackName)} result` : `▸ ${singleLine(decoded.toolName)} · unmatched tool result ${singleLine(decoded.toolCallId)}`;
          body.addChild(new Text(theme.fg(decoded.isError ? "error" : "accent", resultLabel), 0, 0));
          markdown(decoded.content.map((block) => block.text).join("\n") || (decoded.isError ? "Tool failed without text output" : "Tool returned no text output"));
        }
        continue;
      }

      if (decoded.kind === "bashExecution") {
        beforeMessage();
        if (options) {
          const bash = new BashExecutionComponent(decoded.command, options.tui, decoded.excludeFromContext ?? false);
          if (decoded.output) bash.appendOutput(decoded.output);
          bash.setComplete(decoded.exitCode, decoded.cancelled, undefined, decoded.fullOutputPath);
          body.addChild(bash);
        } else {
          text(`$ ${decoded.command}`);
          if (decoded.output) text(decoded.output);
        }
        continue;
      }

      if (decoded.kind === "summary") {
        beforeMessage();
        body.addChild(new Spacer(1));
        const summary = decoded.message.role === "branchSummary"
          ? new BranchSummaryMessageComponent(decoded.message, getMarkdownTheme())
          : new CompactionSummaryMessageComponent(decoded.message, getMarkdownTheme());
        summary.setExpanded(true);
        body.addChild(summary);
        continue;
      }

      beforeMessage();
      if (decoded.kind === "invalid") {
        body.addChild(new Text(theme.fg("warning", "\nTranscript entry could not be displayed; the original entry follows."), 0, 0));
        text(decoded.text);
      } else if (entry.role === "system") {
        body.addChild(new Text(theme.fg("dim", "\n── System notice ──"), 0, 0));
        markdown(decoded.text);
      } else if (entry.role === "tool") {
        body.addChild(new Text(theme.fg("accent", "\n▸ Tool result · raw transcript"), 0, 0));
        markdown(decoded.text);
      } else {
        body.addChild(new Text(theme.fg("muted", `\n── ${singleLine(entry.role)} message ──`), 0, 0));
        markdown(decoded.text);
      }
    }

    if (assignment.report !== undefined && !assistantTexts.has(assignment.report)) { text("\nFinal report"); markdown(assignment.report); }
    if (assignment.partialReport !== undefined && !assistantTexts.has(assignment.partialReport)) { text("\nPartial report"); markdown(assignment.partialReport); }
  }
  if (worker.pendingQuestion) { text("\nAnswer needed"); markdown(worker.pendingQuestion.text); }
  if (observation?.liveText && worker.status === "running") { text("\n◍ Streaming output"); markdown(observation.liveText); }
  building = false;
  return body;
}
