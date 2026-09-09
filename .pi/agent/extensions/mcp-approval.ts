import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAskUserQuestion } from "./ask-user-question";
import {
  isPermissionsStrictStateEvent,
  PERMISSIONS_STRICT_STATE_CHANNEL,
} from "./permissions-mode";

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
  strictEnabled: boolean,
): boolean {
  if (!isMcpToolApprovalRequest(value) || ctx === undefined) return false;
  if (!strictEnabled) {
    // Do not cache normal-mode approval so enabling strict mode affects the next request.
    return value.claim(() => "allow_once");
  }
  if (ctx.hasUI !== true) return value.claim(() => "deny");
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
  let strictEnabled = false;

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    activeSessionId = ctx.sessionManager.getHeader()?.id;
    strictEnabled = false;
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
    activeSessionId = undefined;
    strictEnabled = false;
  });
  // The shared bus is trusted in-process; exact session matching prevents
  // lifecycle bleed but is not an authentication boundary between extensions.
  pi.events.on(PERMISSIONS_STRICT_STATE_CHANNEL, (value) => {
    if (!isPermissionsStrictStateEvent(value) || value.sessionId !== activeSessionId) return;
    strictEnabled = value.strictEnabled;
  });
  pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value) => {
    routeApprovalRequest(value, activeContext, strictEnabled);
  });
}

export default function mcpApproval(pi: ExtensionAPI): void {
  registerMcpApprovalRouting(pi);
}
