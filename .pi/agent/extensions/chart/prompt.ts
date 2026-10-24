import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { registerDeclaredToolGuidance } from "../shared/declared-tool-guidance";

const CHART_GUIDANCE = `Chart tools are available for creating visualizations of timelines, hierarchies, relationships, and quantitative data. Choose one specific chart type and discover it by name or capability with \`tool_search\` (for example, \`chart_line\`); loading one chart does not activate sibling tools. In codemode, use \`tools.tool_load({ query: "chart_line", limit: 1 })\` when a specific inactive chart needs activation. Optimize complex charts for visible parseability: prefer networks of about 12 nodes and 25 edges or fewer, avoid dense reciprocal/self-loop graphs unless those relationships matter, and use short labels or split the graph. Prefer trees of about 32 nodes or fewer and split broad/deep hierarchies. Keep Gantt timelines near 16 tasks with modest milestone counts, especially under a height cap. Treemaps read best with short labels and balanced values; extreme value skew makes small tiles disappear. Heatmaps read best with bounded value ranges and modest row/column counts; normalize or summarize extreme dynamic ranges. Exact data remains available in the chart summary and accessibility description when visible labels are omitted.`;

export function registerChartGuidance(pi: ExtensionAPI): void {
  registerDeclaredToolGuidance(pi, "chart_visuals", (declared, ctx) => {
    // Reuse Pi's renderer capability result so prompt guidance follows protocol overrides and multiplexers.
    if (ctx.mode !== "tui" || ctx.hasUI !== true || getCapabilities().images === null) return "";
    const charts = pi
      .getAllTools()
      .filter((tool) => tool.name.startsWith("chart_") && tool.exposure !== "hidden");
    if (charts.length === 0) return "";
    return charts.some((tool) => declared.has(tool.name))
      ? CHART_GUIDANCE
      : "For charts, discover one chart_* tool with tool_search; loading one chart does not activate sibling tools.";
  });
}
