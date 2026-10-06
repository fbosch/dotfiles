import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import skillDiscovery from "../../index";

export default function runtimeCheck(pi: ExtensionAPI): void {
  let search: ((ctx: ExtensionToolContext) => Promise<string>) | undefined;
  let options: BeforeAgentStartEvent["systemPromptOptions"] | undefined;
  let searchResult = "";
  let classifierCandidates: string[] = [];
  skillDiscovery(
    {
      ...pi,
      registerTool(tool) {
        if (tool.name === "skill_search") {
          search = async (ctx) => {
            const args = Value.Parse(tool.parameters, { query: "xstate", limit: 1 });
            const result = await tool.execute(
              "runtime-search",
              args,
              new AbortController().signal,
              undefined,
              ctx,
            );
            return result.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n");
          };
        }
        pi.registerTool(tool);
      },
    },
    {
      getConfig: () => ({ enabled: true, threshold: 0.72, timeoutMs: 2400, maxRecommendations: 3 }),
      selectSkillsDetailed: async (_prompt, candidates) => {
        classifierCandidates = candidates.map((skill) => skill.name);
        return {
          ok: true,
          value: {
            recommendations: [{ name: "xstate", score: 0.95 }],
            scores: new Map([["xstate", 0.95]]),
          },
        };
      },
    },
  );
  pi.on("before_agent_start", async (event, ctx) => {
    if (search === undefined) throw new Error("skill_search was not registered");
    options = event.systemPromptOptions;
    searchResult = await search({
      ...ctx,
      tools: [],
      executeTool: async () => {
        throw new Error("Nested calls are not used in this fixture");
      },
    });
  });
  pi.on("context_with_system", (event, ctx) => {
    const prompt = ctx.getSystemPrompt();
    const systems = JSON.stringify(event.messages.filter((message) => message.role === "system"));
    const report = {
      coldVisible: prompt.includes("<name>xstate</name>"),
      globalColdVisible: prompt.includes("<name>global-cold</name>"),
      globalWarmVisible: prompt.includes("<name>global-warm</name>"),
      localWarmVisible: prompt.includes("<name>local-warm</name>"),
      explicitOnlyVisible: prompt.includes("<name>explicit-only</name>"),
      structuredColdVisible: systems.includes("<name>xstate</name>"),
      structuredGlobalColdVisible: systems.includes("<name>global-cold</name>"),
      structuredWarmVisible: systems.includes("<name>global-warm</name>"),
      optionsColdVisible: options?.skills?.some((skill) => skill.name === "xstate"),
      classifierCandidates,
      recommendations: options?.sections?.skill_recommendations,
      structuredRecommendation: systems.includes('name=\\"xstate\\"'),
      recommendationEntries: ctx.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === "skill-recommendations")
        .map((entry) => (entry.type === "custom" ? entry.data : undefined)),
      userOnlyEntryInModelContext: JSON.stringify(event.messages).includes("skill-recommendations"),
      searchResult,
    };
    console.log(`SKILL_RUNTIME_CHECK ${JSON.stringify(report)}`);
    process.exit(0);
  });
}
