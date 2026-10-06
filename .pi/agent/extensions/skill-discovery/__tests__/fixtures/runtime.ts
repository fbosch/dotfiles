import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import skillDiscovery from "../../index";

export default function runtimeCheck(pi: ExtensionAPI): void {
  let search: ((ctx: ExtensionToolContext) => Promise<string>) | undefined;
  skillDiscovery({
    ...pi,
    registerTool(tool) {
      if (tool.name === "search_skills") {
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
  });
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      if (search === undefined) throw new Error("search_skills was not registered");
      const searchResult = await search({
        ...ctx,
        tools: [],
        executeTool: async () => {
          throw new Error("Nested calls are not used in this fixture");
        },
      });
      const prompt = event.systemPrompt;
      const report = {
        coldVisible: prompt.includes("<name>xstate</name>"),
        globalColdVisible: prompt.includes("<name>global-cold</name>"),
        globalWarmVisible: prompt.includes("<name>global-warm</name>"),
        localWarmVisible: prompt.includes("<name>local-warm</name>"),
        explicitOnlyVisible: prompt.includes("<name>explicit-only</name>"),
        searchResult,
      };
      console.log(`SKILL_RUNTIME_CHECK ${JSON.stringify(report)}`);
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
}
