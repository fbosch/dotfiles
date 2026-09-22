import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
  requestVercelGateway,
  type VercelGatewayFailureReason,
  type VercelGatewayFetch,
} from "../../lib/vercel-gateway";
import {
  type AgentCatalog,
  type AgentDiscoveryOptions,
  discoverAgentDefinitions,
} from "./discovery";
import type { RecommendAgentConfig } from "./settings";

export const RECOMMEND_AGENT_TOOL_NAME = "recommend_agent" as const;
export const RECOMMEND_AGENT_STATE_LIMIT = 4096;

export const RecommendAgentParameters = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 2400, description: "One scoped task to route." }),
  intent: Type.String({
    minLength: 1,
    maxLength: 1200,
    description: "The desired specialist outcome.",
  }),
  context: Type.Optional(
    Type.String({
      maxLength: 1600,
      description:
        "A brief sanitized summary; never include transcripts, file contents, paths, or credentials.",
    }),
  ),
});

export type RecommendAgentParameters = Static<typeof RecommendAgentParameters>;

export type RecommendationDecision =
  | { readonly decision: "recommend"; readonly agentId: string }
  | { readonly decision: "stay" }
  | { readonly decision: "abstain"; readonly reason: RecommendationAbstainReason };

export type RecommendationAbstainReason =
  | "disabled"
  | "invalid-input"
  | "explicit-routing"
  | "discovery-failure"
  | "catalog-too-large"
  | "gateway-failure"
  | "invalid-evaluation-response"
  | "uncertain"
  | "model-abstain"
  | "stale-catalog";

export interface RecommendationEvaluation {
  readonly decision: RecommendationDecision;
  readonly catalogKind?: "discovered-definitions";
  readonly catalogRevision?: string;
  readonly gatewayFailure?: VercelGatewayFailureReason;
}

export interface RecommendationRequest {
  readonly task: string;
  readonly intent: string;
  readonly context?: string;
}

export interface RecommendationRuntimeOptions {
  readonly modelRegistry: Pick<ModelRegistry, "getProviderAuth">;
  readonly config: RecommendAgentConfig;
  readonly discovery: AgentDiscoveryOptions;
  readonly fetch?: VercelGatewayFetch;
  readonly signal?: AbortSignal;
}

interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Record<string, string>;
}

interface RecommendationGatewayRequest {
  readonly state: {
    readonly task: string;
    readonly intent: string;
    readonly context?: string;
    readonly catalog: "discovered-definitions";
    readonly agents: readonly { readonly id: string; readonly description: string }[];
  };
  readonly questions: { readonly route: ChoiceQuestion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeInput(value: string, maxLength: number): string {
  const withoutControls = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  return withoutControls
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/(?:^|\s)(?:~|\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)[^\s]*/gu, " [redacted-path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function hasExplicitRouting(request: RecommendationRequest): boolean {
  const text = `${request.task} ${request.intent}`;
  return /(?:^|\s)@[A-Za-z0-9][A-Za-z0-9_-]*(?=\s|$)|(?:^|\s)\/(?:agent|subagent):[^\s]+/iu.test(
    text,
  );
}

function buildGatewayRequest(
  request: RecommendationRequest,
  catalog: AgentCatalog,
): RecommendationGatewayRequest {
  const criteria: Record<string, string> = {};
  for (const definition of catalog.definitions) {
    criteria[definition.id] =
      `Recommend this existing agent only when its role fits: ${definition.description}`;
  }
  criteria.stay =
    "The primary agent should keep this one scoped task; no specialist adds enough value.";
  criteria.abstain =
    "The task is underspecified, multi-task, uncertain, or no listed agent is a safe fit.";

  const state: RecommendationGatewayRequest["state"] = {
    task: sanitizeInput(request.task, 2400),
    intent: sanitizeInput(request.intent, 1200),
    catalog: "discovered-definitions",
    agents: catalog.definitions.map(({ id, description }) => ({ id, description })),
  };
  const context = request.context === undefined ? undefined : sanitizeInput(request.context, 1600);
  if (context !== undefined && context.length > 0)
    return { state: { ...state, context }, questions: { route: question(criteria) } };
  return { state, questions: { route: question(criteria) } };
}

function question(criteria: Record<string, string>): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "For this one scoped task, choose exactly one existing agent, stay, or abstain. Explicit user routing always wins. Choose abstain when the task is ambiguous, combines tasks, or the catalog does not clearly fit. This is advisory only; do not invoke or spawn an agent.",
    criteria,
  };
}

function isFiniteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseChoice(
  value: unknown,
  catalog: AgentCatalog,
  config: RecommendAgentConfig,
): RecommendationDecision {
  if (!isRecord(value) || !isRecord(value.answers))
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  const answer = value.answers.route;
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  }

  const choices = [...catalog.definitions.map(({ id }) => id), "stay", "abstain"];
  if (
    !choices.includes(answer.choice) ||
    !isRecord(answer.probabilities) ||
    !isFiniteUnit(answer.confidence)
  ) {
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  }
  const probabilities = answer.probabilities;
  const probabilityKeys = Object.keys(probabilities).sort();
  const expectedKeys = [...choices].sort();
  if (
    probabilityKeys.length !== expectedKeys.length ||
    probabilityKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  }
  const values = choices.map((choice) => probabilities[choice]);
  if (!values.every(isFiniteUnit))
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  const total = values.reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 0.02)
    return { decision: "abstain", reason: "invalid-evaluation-response" };

  const ranked = choices
    .map((choice) => ({ choice, probability: probabilities[choice] as number }))
    .sort((left, right) => right.probability - left.probability);
  const selected = probabilities[answer.choice];
  if (!isFiniteUnit(selected))
    return { decision: "abstain", reason: "invalid-evaluation-response" };
  const margin =
    selected - (ranked.find(({ choice }) => choice !== answer.choice)?.probability ?? 0);
  if (
    selected !== ranked[0]?.probability ||
    selected < config.minProbability ||
    answer.confidence < config.minProbability ||
    margin < config.minMargin
  ) {
    return { decision: "abstain", reason: "uncertain" };
  }
  if (answer.choice === "stay") return { decision: "stay" };
  if (answer.choice === "abstain") return { decision: "abstain", reason: "model-abstain" };
  return { decision: "recommend", agentId: answer.choice };
}

export async function recommendAgent(
  request: RecommendationRequest,
  options: RecommendationRuntimeOptions,
): Promise<RecommendationEvaluation> {
  if (!options.config.enabled) return { decision: { decision: "abstain", reason: "disabled" } };
  if (
    !request ||
    typeof request.task !== "string" ||
    typeof request.intent !== "string" ||
    request.task.trim().length === 0 ||
    request.intent.trim().length === 0 ||
    (request.context !== undefined && typeof request.context !== "string") ||
    request.task.length > 2400 ||
    request.intent.length > 1200 ||
    (request.context !== undefined && request.context.length > 1600) ||
    request.task.length + request.intent.length + (request.context?.length ?? 0) >
      RECOMMEND_AGENT_STATE_LIMIT
  ) {
    return { decision: { decision: "abstain", reason: "invalid-input" } };
  }
  if (hasExplicitRouting(request))
    return { decision: { decision: "abstain", reason: "explicit-routing" } };

  const discovered = discoverAgentDefinitions(options.discovery);
  if (!discovered.catalog) {
    const reason =
      discovered.failure === "catalog-too-large" ? "catalog-too-large" : "discovery-failure";
    return { decision: { decision: "abstain", reason } };
  }
  const catalog = discovered.catalog;
  const gatewayRequest = buildGatewayRequest(request, catalog);
  const gateway = await requestVercelGateway(options.modelRegistry, gatewayRequest, {
    timeoutMs: options.config.timeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!gateway.ok) {
    return {
      decision: { decision: "abstain", reason: "gateway-failure" },
      catalogKind: catalog.kind,
      catalogRevision: catalog.revision,
      gatewayFailure: gateway.reason,
    };
  }

  const decision = parseChoice(gateway.value, catalog, options.config);
  if (decision.decision === "recommend") {
    const current = discoverAgentDefinitions(options.discovery).catalog;
    if (
      !current ||
      current.revision !== catalog.revision ||
      !current.definitions.some(({ id }) => id === decision.agentId)
    ) {
      return {
        decision: { decision: "abstain", reason: "stale-catalog" },
        catalogKind: catalog.kind,
        catalogRevision: catalog.revision,
      };
    }
  }
  return { decision, catalogKind: catalog.kind, catalogRevision: catalog.revision };
}

export function renderRecommendation(evaluation: RecommendationEvaluation): string {
  if (evaluation.decision.decision === "recommend") {
    return `Recommended: ${evaluation.decision.agentId}`;
  }
  if (evaluation.decision.decision === "stay") {
    return "Stay with primary";
  }
  return "No recommendation";
}
