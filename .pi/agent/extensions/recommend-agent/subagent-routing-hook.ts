import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { findAgentMentions, loadAgentMentions } from "../mentions/agent-mentions";
import { type RecommendationEvaluation, recommendAgent } from "./recommendation";
import { type RecommendAgentConfig, readGlobalRecommendAgentConfig } from "./settings";

const SUBAGENT_TOOL_NAME = "subagent";
const MAX_ROUTING_TASK_LENGTH = 2400;
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
      return undefined;
    }

    const reason = blockReason(evaluation, agent);
    return reason === undefined ? undefined : { block: true, reason };
  });
}
