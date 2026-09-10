import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";

export const CHART_GUIDANCE_START = "<chart_visuals>";
export const CHART_GUIDANCE_END = "</chart_visuals>";

const CHART_GUIDANCE = `Chart tools are available for creating visualizations of timelines, hierarchies, relationships, and quantitative data. They may be deferred from the active tool set, so use \`search_tools\` with \`chart_\` to discover them when a visualization would help.`;

export function appendChartGuidance(systemPrompt: string): string {
  const block = `${CHART_GUIDANCE_START}\n${CHART_GUIDANCE}\n${CHART_GUIDANCE_END}`;
  const start = systemPrompt.indexOf(CHART_GUIDANCE_START);
  const end = systemPrompt.indexOf(CHART_GUIDANCE_END);

  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start) return systemPrompt;
    const before = systemPrompt.slice(0, start).trimEnd();
    const after = systemPrompt.slice(end + CHART_GUIDANCE_END.length).trimStart();
    return [before, block, after].filter((part) => part.length > 0).join("\n\n");
  }

  return systemPrompt.length === 0 ? block : `${systemPrompt}\n\n${block}`;
}

export function registerChartGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    // Reuse Pi's renderer capability result so prompt guidance follows protocol overrides and multiplexers.
    if (ctx.mode !== "tui" || ctx.hasUI !== true || getCapabilities().images === null) return;
    if (pi.getAllTools().some((tool) => tool.name.startsWith("chart_") === true) === false) return;

    return {
      systemPrompt: appendChartGuidance(event.systemPrompt),
    };
  });
}
