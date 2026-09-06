import type { Usage } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, SourceInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { agentToolError } from "../../lib/tool-exposure";
import {
  type CodeModeExecutionResult,
  type CodeModeOutputItem,
  type CodeModeTool,
  executeCodeMode,
} from "./host";

const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_NESTED_RESULT_BYTES = 256 * 1024;
const MAX_NESTED_IMAGE_BYTES = 192 * 1024;
const MAX_TOTAL_NESTED_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_IMAGES = 4;
const MAX_OUTPUT_BYTES = 50 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_OUTPUT_LINES = 2_000;

export const PROGRAMMATIC_TOOL_NAMES = new Set([
  "read",
  "ffgrep",
  "fffind",
  "find_definition",
  "find_callers",
  "find_callees",
  "get_symbol_body",
  "list_symbols",
  "lsp",
  "git_diff",
  "websearch",
  "webfetch",
  "read_session",
]);

interface InvokedToolResult {
  toolCallId: string;
  toolName: string;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

interface NestedDispatchAPI {
  invokeTool(
    toolName: string,
    input: unknown,
    options: {
      parentToolCallId: string;
      signal?: AbortSignal;
      expectedSourceInfo: SourceInfo;
      expectedRegistrationId: string;
    },
  ): Promise<InvokedToolResult>;
}

type DiscoveredTool = ReturnType<ExtensionAPI["getAllTools"]>[number] & {
  programmatic?: "read-only";
  registrationId?: string;
};

function hasNestedDispatch(pi: ExtensionAPI): pi is ExtensionAPI & NestedDispatchAPI {
  return typeof (pi as { invokeTool?: unknown }).invokeTool === "function";
}

function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total;
  if (!total) {
    return {
      ...next,
      cost: { ...next.cost },
    };
  }

  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    ...("cacheWrite1h" in total || "cacheWrite1h" in next
      ? { cacheWrite1h: (total.cacheWrite1h ?? 0) + (next.cacheWrite1h ?? 0) }
      : {}),
    ...("reasoning" in total || "reasoning" in next
      ? { reasoning: (total.reasoning ?? 0) + (next.reasoning ?? 0) }
      : {}),
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;

  let truncated = bytes.subarray(0, maxBytes).toString("utf8");
  while (truncated.endsWith("�")) truncated = truncated.slice(0, -1);
  return truncated;
}

function nestedResultText(result: AgentToolResult<unknown>): string {
  const parts: string[] = [];
  for (const item of result.content) {
    if (item.type === "text") {
      parts.push(item.text);
      continue;
    }

    const imageBytes = Buffer.byteLength(item.data, "base64");
    if (imageBytes > MAX_NESTED_IMAGE_BYTES) {
      parts.push(`[Image omitted: ${imageBytes} bytes exceeds the nested Code Mode limit.]`);
      continue;
    }
    parts.push(`data:${item.mimeType};base64,${item.data}`);
  }

  const joined = parts.join("\n");
  if (Buffer.byteLength(joined) <= MAX_NESTED_RESULT_BYTES) return joined;
  return `${truncateUtf8(joined, MAX_NESTED_RESULT_BYTES)}\n[Tool result truncated by Code Mode.]`;
}

function parseDataImage(url: string): { data: string; mimeType: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(url);
  if (!match) throw new Error("Code Mode can emit only base64 data images.");

  const mimeType = match[1];
  const data = match[2];
  if (!mimeType || !data) throw new Error("Code Mode emitted an empty data image.");
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`Code Mode emitted an unsupported image type: ${mimeType}`);
  }
  const bytes = Buffer.byteLength(data, "base64");
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Code Mode image output exceeds ${MAX_IMAGE_BYTES} bytes.`);
  }
  return { data, mimeType };
}

function resultContent(items: readonly CodeModeOutputItem[]): AgentToolResult<unknown>["content"] {
  for (const item of items) {
    if (item.type === "input_text" && typeof item.text !== "string") {
      throw new Error("Code Mode emitted invalid text output.");
    }
    if (item.type === "input_image" && typeof item.image_url !== "string") {
      throw new Error("Code Mode emitted invalid image output.");
    }
    if (!new Set(["input_text", "input_image", "input_audio"]).has(item.type)) {
      throw new Error(`Code Mode emitted an unknown output type: ${String(item.type)}`);
    }
  }

  const text = items
    .filter(
      (item): item is CodeModeOutputItem & { type: "input_text"; text: string } =>
        item.type === "input_text",
    )
    .map((item) => item.text)
    .join("\n");
  const lines = text.split("\n");
  const limitedLines = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
  const limitedText = truncateUtf8(limitedLines, MAX_OUTPUT_BYTES);
  const truncated = limitedText !== text;
  const content: AgentToolResult<unknown>["content"] = [];

  if (limitedText.length > 0) {
    content.push({
      type: "text",
      text: truncated ? `${limitedText}\n[Code Mode output truncated.]` : limitedText,
    });
  }

  let imageCount = 0;
  let imageBytes = 0;
  for (const item of items) {
    if (item.type === "input_image" && typeof item.image_url === "string") {
      const image = parseDataImage(item.image_url);
      imageCount += 1;
      imageBytes += Buffer.byteLength(image.data, "base64");
      if (imageCount > MAX_OUTPUT_IMAGES || imageBytes > MAX_OUTPUT_IMAGE_BYTES) {
        throw new Error(
          `Code Mode image output exceeds ${MAX_OUTPUT_IMAGES} images or ${MAX_OUTPUT_IMAGE_BYTES} bytes.`,
        );
      }
      content.push({ type: "image", ...image });
    } else if (item.type === "input_audio") {
      throw new Error("Code Mode audio output is not supported.");
    }
  }

  if (content.length === 0)
    content.push({ type: "text", text: "Code Mode completed with no output." });
  return content;
}

function runtimeError(result: CodeModeExecutionResult): Error | undefined {
  if (!result.errorText) return undefined;
  const text = result.contentItems
    .filter((item) => item.type === "input_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  const message = text ? `${result.errorText}\nOutput:\n${text}` : result.errorText;
  return new Error(truncateUtf8(message, MAX_OUTPUT_BYTES));
}

export default function codeModeExtension(pi: ExtensionAPI): void {
  let running = false;

  pi.registerTool({
    name: "exec",
    label: "Code Mode",
    description:
      "Execute JavaScript in a restricted V8 runtime and orchestrate active read-only tools through tools.<name>(args). Await tool calls and emit only the final answer with text(value) or image(dataUrl). Nested results remain runtime-local. No Node.js, filesystem, direct network access, or console. Maximum 64 nested calls, 60 seconds, 2000 output lines, 50KB of text output, and 4 images.",
    parameters: Type.Object(
      {
        code: Type.String({
          minLength: 1,
          maxLength: MAX_SOURCE_BYTES,
          description: "JavaScript source to execute in the restricted runtime.",
        }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(toolCallId, params, signal, onUpdate) {
      if (!hasNestedDispatch(pi)) {
        throw new Error("Code Mode requires a Pi build with nested tool dispatch support.");
      }
      if (running) throw new Error("Code Mode is already running in this session.");
      if (Buffer.byteLength(params.code) > MAX_SOURCE_BYTES) {
        throw new Error(`Code Mode source exceeds ${MAX_SOURCE_BYTES} bytes.`);
      }

      const active = new Set(pi.getActiveTools());
      const discoveredTools = pi.getAllTools() as DiscoveredTool[];
      const tools: CodeModeTool[] = discoveredTools
        .filter(
          (
            tool,
          ): tool is DiscoveredTool & {
            programmatic: "read-only";
            registrationId: string;
          } =>
            active.has(tool.name) &&
            PROGRAMMATIC_TOOL_NAMES.has(tool.name) &&
            tool.programmatic === "read-only" &&
            typeof tool.registrationId === "string",
        )
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
          sourceInfo: tool.sourceInfo,
          registrationId: tool.registrationId,
        }));
      if (tools.length === 0) {
        throw new Error("Code Mode has no active read-only tools to invoke.");
      }

      const timeoutSignal = AbortSignal.timeout(EXECUTION_TIMEOUT_MS);
      const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      let usage: Usage | undefined;
      let nestedResultBytes = 0;
      let nestedToolCalls = 0;
      let terminateRequested = false;
      running = true;

      try {
        const result = await executeCodeMode({
          source: params.code,
          toolCallId,
          tools,
          signal: executionSignal,
          async invokeTool(tool, input, nestedSignal) {
            nestedToolCalls += 1;
            const nested = await pi.invokeTool(tool.name, input, {
              parentToolCallId: toolCallId,
              signal: nestedSignal,
              expectedSourceInfo: tool.sourceInfo,
              expectedRegistrationId: tool.registrationId,
            });
            usage = addUsage(usage, nested.result.usage);
            terminateRequested ||= nested.result.terminate === true;
            const value = nestedResultText(nested.result);
            nestedResultBytes += Buffer.byteLength(value);
            if (nestedResultBytes > MAX_TOTAL_NESTED_RESULT_BYTES) {
              throw new Error(
                `Code Mode nested results exceed ${MAX_TOTAL_NESTED_RESULT_BYTES} bytes.`,
              );
            }
            if (nested.isError) {
              throw new Error(value || `${tool.name} failed without output.`);
            }
            return {
              value,
              ...(nested.result.terminate === true ? { terminate: true } : {}),
            };
          },
          onNotification(text) {
            onUpdate?.({
              content: [{ type: "text", text: truncateUtf8(text, 2_000) }],
              details: { running: true },
            });
          },
        });
        const error = runtimeError(result);
        if (error) throw error;

        return {
          content: resultContent(result.contentItems),
          details: {
            nestedToolCalls: result.nestedToolCalls,
            hostDurationMs: Math.round(result.hostDurationNs / 1_000_000),
          },
          ...(usage ? { usage } : {}),
          ...(result.terminate || terminateRequested ? { terminate: true } : {}),
        };
      } catch (error) {
        const failure =
          timeoutSignal.aborted && !signal?.aborted
            ? new Error(`Code Mode exceeded ${EXECUTION_TIMEOUT_MS / 1_000} seconds.`)
            : error;
        if (!terminateRequested) throw failure;
        const message = failure instanceof Error ? failure.message : String(failure);
        throw agentToolError(message, {
          content: [{ type: "text", text: message }],
          details: { nestedToolCalls, terminated: true },
          ...(usage ? { usage } : {}),
          terminate: true,
        });
      } finally {
        running = false;
      }
    },
  });
}
