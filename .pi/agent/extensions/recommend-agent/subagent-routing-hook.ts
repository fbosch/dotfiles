import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { findAgentMentions, loadAgentMentions } from "../mentions/agent-mentions";
import {
  type RecommendationAbstainReason,
  type RecommendationEvaluation,
  recommendAgent,
} from "./recommendation";
import { type RecommendAgentConfig, readGlobalRecommendAgentConfig } from "./settings";

const SUBAGENT_TOOL_NAME = "subagent";
const ROUTING_DIAGNOSTIC_ENTRY = "recommend-agent-routing";
const MAX_ROUTING_TASK_LENGTH = 2400;
const MAX_DIAGNOSTIC_AGENT_ID_LENGTH = 80;
const EXPLICIT_SUBAGENT_MARKER = "<explicit-subagent-invocation>";

interface SubagentInput {
  readonly prompt?: unknown;
  readonly subagent_type?: unknown;
  readonly resume?: unknown;
}

export interface SubagentRoutingHookDependencies {
  readonly agentDirectory?: string;
  readonly readConfig?: () => RecommendAgentConfig;
  readonly evaluate?: (
    request: { task: string; intent: string },
    context: ExtensionContext,
    config: RecommendAgentConfig,
  ) => Promise<RecommendationEvaluation>;
}

interface HookState {
  evaluationAttempted: boolean;
  explicitBypass: boolean;
}

type RoutingDiagnosticDecision = "agreement" | "disagreement" | "stay" | "abstain" | "unavailable";
type RoutingDiagnosticReason = RecommendationAbstainReason | "evaluation-failure";

interface RoutingDiagnostic {
  readonly version: 1;
  readonly proposedAgentId: string;
  readonly selectedAgentId?: string;
  readonly decision: RoutingDiagnosticDecision;
  readonly reason?: RoutingDiagnosticReason;
  readonly gatewayFailure?: RecommendationEvaluation["gatewayFailure"];
  readonly gatewayProvider?: RecommendationEvaluation["gatewayProvider"];
  readonly elapsedMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromUserMessage(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "user") return undefined;
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter((part): part is { type: "text"; text: string } => {
      return isRecord(part) && part.type === "text" && typeof part.text === "string";
    })
    .map((part) => part.text)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function latestUserBranchText(ctx: ExtensionContext): string | undefined {
  for (const entry of ctx.sessionManager.getBranch().slice().reverse()) {
    if (!isRecord(entry) || entry.type !== "message") continue;
    const text = textFromUserMessage(entry.message);
    if (text !== undefined) return text;
  }
  return undefined;
}

function hasExplicitAgentSelection(
  text: string | undefined,
  ctx: ExtensionContext,
  agentDirectory: string | undefined,
): boolean {
  if (text === undefined) return false;
  if (text.includes(EXPLICIT_SUBAGENT_MARKER)) return true;

  const mentions = loadAgentMentions(ctx.cwd, agentDirectory, ctx.isProjectTrusted?.() ?? false);
  return findAgentMentions(text, mentions, ctx.cwd).length > 0;
}

function proposedSubagentInput(event: ToolCallEvent): SubagentInput | undefined {
  if (event.toolName !== SUBAGENT_TOOL_NAME || !isRecord(event.input)) return undefined;
  return event.input;
}

function safeAgentId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/gu, "_");
  return (normalized || "unknown").slice(0, MAX_DIAGNOSTIC_AGENT_ID_LENGTH);
}

function elapsedMs(startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function diagnosticForEvaluation(
  evaluation: RecommendationEvaluation,
  proposedAgent: string,
  startedAt: number,
): RoutingDiagnostic {
  const common = {
    version: 1 as const,
    proposedAgentId: safeAgentId(proposedAgent),
    elapsedMs: elapsedMs(startedAt),
  };
  const decision = evaluation.decision;

  if (decision.decision === "recommend") {
    return {
      ...common,
      decision: decision.agentId === proposedAgent ? "agreement" : "disagreement",
      selectedAgentId: safeAgentId(decision.agentId),
      ...(evaluation.gatewayFailure === undefined
        ? {}
        : { gatewayFailure: evaluation.gatewayFailure }),
      ...(evaluation.gatewayProvider === undefined
        ? {}
        : { gatewayProvider: evaluation.gatewayProvider }),
    };
  }

  if (decision.decision === "stay") {
    return { ...common, decision: "stay" };
  }

  return {
    ...common,
    decision:
      evaluation.gatewayFailure !== undefined || decision.reason === "gateway-failure"
        ? "unavailable"
        : "abstain",
    reason: decision.reason,
    ...(evaluation.gatewayFailure === undefined
      ? {}
      : { gatewayFailure: evaluation.gatewayFailure }),
    ...(evaluation.gatewayProvider === undefined
      ? {}
      : { gatewayProvider: evaluation.gatewayProvider }),
  };
}

function diagnosticForFailure(proposedAgent: string, startedAt: number): RoutingDiagnostic {
  return {
    version: 1,
    proposedAgentId: safeAgentId(proposedAgent),
    decision: "unavailable",
    reason: "evaluation-failure",
    elapsedMs: elapsedMs(startedAt),
  };
}

function diagnosticReasonLabel(diagnostic: RoutingDiagnostic): string {
  if (diagnostic.gatewayFailure !== undefined) {
    const labels: Record<NonNullable<RoutingDiagnostic["gatewayFailure"]>, string> = {
      "missing-credentials": "missing credentials",
      "auth-failure": "authentication failed",
      timeout: "timed out",
      "caller-cancellation": "cancelled",
      "request-failure": "request failed",
      "http-status": "provider rejected request",
      "invalid-json": "invalid response",
      "oversized-body": "response too large",
      "body-failure": "response failed",
    };
    return labels[diagnostic.gatewayFailure];
  }

  const labels: Record<RoutingDiagnosticReason, string> = {
    disabled: "disabled",
    "invalid-input": "invalid input",
    "explicit-routing": "explicit routing",
    "discovery-failure": "agent discovery failed",
    "catalog-too-large": "agent catalog too large",
    "gateway-failure": "gateway failure",
    "invalid-evaluation-response": "invalid response",
    uncertain: "uncertain",
    "model-abstain": "model abstained",
    "stale-catalog": "stale catalog",
    "routing-policy-unavailable": "routing policy unavailable",
    "evaluation-failure": "evaluation failed",
  };
  return diagnostic.reason === undefined ? "unavailable" : labels[diagnostic.reason];
}

function diagnosticMessage(diagnostic: RoutingDiagnostic): string {
  if (diagnostic.decision === "agreement") {
    return `Jev → ${diagnostic.selectedAgentId ?? diagnostic.proposedAgentId} ✓`;
  }
  if (diagnostic.decision === "disagreement") {
    return `Jev → ${diagnostic.selectedAgentId ?? "unknown"} (proposed ${diagnostic.proposedAgentId})`;
  }
  if (diagnostic.decision === "stay") {
    return `Jev → primary (proposed ${diagnostic.proposedAgentId})`;
  }
  if (diagnostic.decision === "abstain") {
    return "Jev → abstain; proceeding";
  }
  return `Jev unavailable: ${diagnosticReasonLabel(diagnostic)}; proceeding`;
}

function reportDiagnostic(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  diagnostic: RoutingDiagnostic,
): void {
  // UI and persistence are advisory surfaces; neither may alter the delegation decision.
  try {
    pi.appendEntry(ROUTING_DIAGNOSTIC_ENTRY, diagnostic);
  } catch {
    // A session persistence failure must not make native delegation unavailable.
  }

  if (!ctx.hasUI) return;
  try {
    ctx.ui.notify(
      diagnosticMessage(diagnostic),
      diagnostic.decision === "unavailable" ? "warning" : "info",
    );
  } catch {
    // A broken UI adapter must not make native delegation unavailable.
  }
}

function blockReason(
  evaluation: RecommendationEvaluation,
  proposedAgent: string,
): string | undefined {
  if (
    evaluation.decision.decision === "recommend" &&
    evaluation.decision.agentId !== proposedAgent
  ) {
    return `Jev routing recommends ${evaluation.decision.agentId} instead; reconsider this delegation.`;
  }
  if (evaluation.decision.decision === "stay") {
    return "Jev routing recommends staying with the primary; reconsider this delegation.";
  }
  return undefined;
}

async function defaultEvaluate(
  request: { task: string; intent: string },
  ctx: ExtensionContext,
  config: RecommendAgentConfig,
): Promise<RecommendationEvaluation> {
  return recommendAgent(request, {
    modelRegistry: ctx.modelRegistry,
    config,
    discovery: {
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      maxCandidates: config.maxCandidates,
    },
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  });
}

export function registerSubagentRoutingHook(
  pi: ExtensionAPI,
  dependencies: SubagentRoutingHookDependencies = {},
): void {
  const agentDirectory = dependencies.agentDirectory;
  const readConfig = dependencies.readConfig ?? readGlobalRecommendAgentConfig;
  const evaluate = dependencies.evaluate ?? defaultEvaluate;
  let state: HookState = { evaluationAttempted: false, explicitBypass: false };

  const reset = () => {
    state = { evaluationAttempted: false, explicitBypass: false };
  };

  pi.on("session_start", (_event, ctx) => {
    reset();
    state.explicitBypass = hasExplicitAgentSelection(
      latestUserBranchText(ctx),
      ctx,
      agentDirectory,
    );
  });

  pi.on("before_agent_start", (event, ctx) => {
    reset();
    state.explicitBypass =
      hasExplicitAgentSelection(latestUserBranchText(ctx), ctx, agentDirectory) ||
      hasExplicitAgentSelection(event.prompt, ctx, agentDirectory) ||
      event.systemPrompt.includes(EXPLICIT_SUBAGENT_MARKER);
  });

  pi.on("session_shutdown", reset);

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    const input = proposedSubagentInput(event);
    if (input === undefined || state.explicitBypass || state.evaluationAttempted) return undefined;

    // Resume is an explicit continuation, not a new delegation to route.
    if ("resume" in input) return undefined;
    if (typeof input.prompt !== "string" || typeof input.subagent_type !== "string") {
      return undefined;
    }

    const task = input.prompt.trim().slice(0, MAX_ROUTING_TASK_LENGTH);
    const agent = input.subagent_type.trim();
    if (task.length === 0 || agent.length === 0) return undefined;

    // Consume the one-evaluation-per-user-turn budget before awaiting Jev, so
    // parallel or retried tool preflight cannot create a repeated blocking loop.
    state.evaluationAttempted = true;
    const startedAt = Date.now();

    let evaluation: RecommendationEvaluation;
    try {
      const config = readConfig();
      if (!config.enabled) return undefined;
      evaluation = await evaluate(
        {
          task,
          intent: `Decide whether ${agent} is the right specialist for this task, or whether another available agent should be used.`,
        },
        ctx,
        config,
      );
    } catch {
      // Routing is advisory and must not make delegation unavailable on Jev failure.
      reportDiagnostic(pi, ctx, diagnosticForFailure(agent, startedAt));
      return undefined;
    }

    reportDiagnostic(pi, ctx, diagnosticForEvaluation(evaluation, agent, startedAt));
    const reason = blockReason(evaluation, agent);
    return reason === undefined ? undefined : { block: true, reason };
  });
}
