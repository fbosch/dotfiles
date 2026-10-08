import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";

const CHART_GUIDANCE = `Chart tools are available for creating visualizations of timelines, hierarchies, relationships, and quantitative data. Choose one specific chart type and discover it by name or capability with \`tool_search\` (for example, \`chart_line\`); loading one chart does not activate sibling tools. In codemode, use \`tools.tool_load({ query: "chart_line", limit: 1 })\` when a specific inactive chart needs activation. Optimize complex charts for visible parseability: prefer networks of about 12 nodes and 25 edges or fewer, avoid dense reciprocal/self-loop graphs unless those relationships matter, and use short labels or split the graph. Prefer trees of about 32 nodes or fewer and split broad/deep hierarchies. Keep Gantt timelines near 16 tasks with modest milestone counts, especially under a height cap. Treemaps read best with short labels and balanced values; extreme value skew makes small tiles disappear. Heatmaps read best with bounded value ranges and modest row/column counts; normalize or summarize extreme dynamic ranges. Exact data remains available in the chart summary and accessibility description when visible labels are omitted.`;

export function registerChartGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    event.systemPromptOptions.sections ??= {};
    event.systemPromptOptions.sections.chart_visuals = "";
    // Reuse Pi's renderer capability result so prompt guidance follows protocol overrides and multiplexers.
    if (ctx.mode !== "tui" || ctx.hasUI !== true || getCapabilities().images === null) return;
    if (pi.getAllTools().some((tool) => tool.name.startsWith("chart_") === true) === false) return;

    event.systemPromptOptions.sections.chart_visuals = CHART_GUIDANCE;
  });
}
