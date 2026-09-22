import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgentDefinitions } from "./discovery";
import {
  RECOMMEND_AGENT_TOOL_NAME,
  type RecommendAgentParameters as RecommendAgentInput,
  RecommendAgentParameters,
  recommendAgent,
  renderRecommendation,
} from "./recommendation";
import { readGlobalRecommendAgentConfig } from "./settings";

function disabledToolNames(pi: ExtensionAPI): string[] {
  return pi.getActiveTools().filter((name) => name !== RECOMMEND_AGENT_TOOL_NAME);
}

export default function recommendAgentExtension(pi: ExtensionAPI): void {
  let registered = false;

  pi.on("session_start", (_event, ctx) => {
    const config = readGlobalRecommendAgentConfig();
    if (!config.enabled) {
      if (registered) pi.setActiveTools(disabledToolNames(pi));
      return;
    }

    if (!registered) {
      pi.registerTool({
        name: RECOMMEND_AGENT_TOOL_NAME,
        label: "Recommend agent",
        description:
          "Advisory-only routing for one scoped task. Uses bounded metadata from discovered agent definitions; never invokes or spawns an agent. Explicit user routing wins. The primary agent must verify availability and permission before native subagent routing.",
        promptSnippet: "Recommend one existing agent, stay, or abstain for one scoped task",
        promptGuidelines: [
          "Use recommend_agent only for one scoped task when the user has not explicitly routed to an agent.",
          "Treat recommend_agent as advisory: never assume availability, permissions, or automatic execution from its result.",
        ],
        parameters: RecommendAgentParameters,
        async execute(_toolCallId, params: RecommendAgentInput, signal, _onUpdate, toolContext) {
          const currentConfig = readGlobalRecommendAgentConfig();
          if (!currentConfig.enabled) {
            const evaluation = {
              decision: { decision: "abstain" as const, reason: "disabled" as const },
            };
            return {
              content: [{ type: "text", text: renderRecommendation(evaluation) }],
              details: evaluation,
            };
          }

          const evaluation = await recommendAgent(params, {
            modelRegistry: toolContext.modelRegistry,
            config: currentConfig,
            discovery: {
              cwd: toolContext.cwd,
              projectTrusted: toolContext.isProjectTrusted(),
              maxCandidates: currentConfig.maxCandidates,
            },
            ...(signal === undefined ? {} : { signal }),
          });
          return {
            content: [{ type: "text", text: renderRecommendation(evaluation) }],
            details: evaluation,
          };
        },
      });
      registered = true;
    }

    const discovered = discoverAgentDefinitions({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      maxCandidates: config.maxCandidates,
    });
    if (discovered.catalog)
      pi.setActiveTools([...new Set([...pi.getActiveTools(), RECOMMEND_AGENT_TOOL_NAME])]);
    else pi.setActiveTools(disabledToolNames(pi));
  });
}
