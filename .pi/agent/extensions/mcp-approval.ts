import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAskUserQuestion } from "./ask-user-question";
import { isYoloEffectiveStateEvent, YOLO_EFFECTIVE_STATE_CHANNEL } from "./yolo";

// Pi packages have isolated module roots, so local extensions consume the
// adapter's broker contract structurally through the shared event bus.
const MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request";

export type McpToolApprovalDecision = "allow_once" | "allow_for_session" | "deny" | "abstain";

type McpToolApprovalHandler = () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>;

export interface McpToolApprovalRequest {
  serverName: string;
  originalToolName: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  claim(handler: McpToolApprovalHandler): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpToolApprovalRequest(value: unknown): value is McpToolApprovalRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverName === "string" &&
    typeof value.originalToolName === "string" &&
    isRecord(value.args) &&
    typeof value.claim === "function" &&
    (value.signal === undefined || value.signal instanceof AbortSignal)
  );
}

function sanitizeDisplayText(value: string, preserveLayout: boolean): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (preserveLayout && (character === "\n" || character === "\t")) return character;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("");
}

function formatArguments(args: Record<string, unknown>): string | undefined {
  try {
    const serialized = JSON.stringify(args, null, 2);
    if (serialized === undefined) return undefined;
    const sanitized = sanitizeDisplayText(serialized, true);
    return sanitized.length > 500 ? `${sanitized.slice(0, 500)}...` : sanitized;
  } catch {
    return undefined;
  }
}

function decisionFromAnswer(
  result: Awaited<ReturnType<typeof runAskUserQuestion>>,
): McpToolApprovalDecision {
  if (result.details.status !== "answered") return "deny";
  const answer = result.details.answers[0];
  if (answer?.type !== "option") return "deny";
  if (
    answer.value === "allow_once" ||
    answer.value === "allow_for_session" ||
    answer.value === "deny"
  ) {
    return answer.value;
  }
  return "deny";
}

function routeApprovalRequest(
  value: unknown,
  ctx: ExtensionContext | undefined,
  yoloEnabled: boolean,
): boolean {
  if (!isMcpToolApprovalRequest(value)) return false;
  if (yoloEnabled) {
    // Keep approvals uncached so disabling YOLO affects the next request.
    return value.claim(() => "allow_once");
  }
  if (ctx?.hasUI !== true) return false;

  const serverName = sanitizeDisplayText(value.serverName, false);
  const toolName = sanitizeDisplayText(value.originalToolName, false);
  const details = formatArguments(value.args);
  return value.claim(async () => {
    if (details === undefined) return "deny";

    const result = await runAskUserQuestion(
      {
        question: `MCP: ${serverName} wants to run ${toolName}`,
        details: `Arguments:\n${details}`,
        options: [
          { label: "Allow once", value: "allow_once" },
          { label: "Allow for session", value: "allow_for_session" },
          { label: "Deny", value: "deny" },
        ],
      },
      value.signal,
      ctx,
      { includeOther: false },
    );
    return decisionFromAnswer(result);
  });
}

export function registerMcpApprovalRouting(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  let activeSessionId: string | undefined;
  let yoloEnabled = false;

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    activeSessionId = ctx.sessionManager.getHeader()?.id;
    yoloEnabled = false;
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
    activeSessionId = undefined;
    yoloEnabled = false;
  });
  pi.events.on(YOLO_EFFECTIVE_STATE_CHANNEL, (value) => {
    if (!isYoloEffectiveStateEvent(value) || value.sessionId !== activeSessionId) return;
    yoloEnabled = value.effectiveEnabled;
  });
  pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value) => {
    routeApprovalRequest(value, activeContext, yoloEnabled);
  });
}

export default function mcpApproval(pi: ExtensionAPI): void {
  registerMcpApprovalRouting(pi);
}
