import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WORKFLOWS = {
  browser_open:
    "Open a new page only when needed. For an existing MCP page, supply its pageId to the other browser tools instead.",
  browser_snapshot: "Read the page and obtain fresh @eN refs for browser actions.",
  browser_act: "Perform a deterministic interaction using the latest browser_snapshot refs.",
  browser_step: "Take one classifier-selected, navigation-only click.",
  browser_run:
    "Run a bounded multi-step objective with explicit inputs. Mark secret inputs as sensitive. It does not derive new input values from page content.",
  browser_decide: "Choose among supplied actions without executing them.",
};

export function registerBrowserGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections ??= {};
    event.systemPromptOptions.sections.browser_workflows = "";
    // Deferred tools are available before activation; excluded tools are absent from this registry.
    const available = new Set(
      pi
        .getAllTools()
        .filter((tool) => tool.exposure !== "hidden")
        .map((tool) => tool.name),
    );
    const workflows = Object.entries(WORKFLOWS).filter(([name]) => available.has(name));
    if (workflows.length === 0) return;

    event.systemPromptOptions.sections.browser_workflows = [
      "Use native `browser_*` tools first for supported browser work, including Chrome MCP and Firefox MCP. Do not default to raw DevTools MCP calls or run agent-browser through bash.",
      "Discover each required browser tool with Pi's `tool_search`. These tools are deferred; `tool_load` does not activate them. Follow this local routing guidance when other browser skills describe only the CLI.",
      ...(available.has("browser_run")
        ? [
            "Prefer `browser_run` for supported multi-step flows over separate browser_act or raw MCP calls, even when individual steps are obvious. Unique input matches already run deterministically. Use browser_snapshot and browser_act for inspection, a single explicit action, or a step browser_run cannot express.",
          ]
        : []),
      ...workflows.map(([name, guidance]) => `- ${name}: ${guidance}`),
      'Set backend: "chrome" or backend: "firefox" explicitly on every MCP browser call, and keep the same backend and pageId. Omitting backend selects agent-browser with Lightpanda, not the previous MCP backend.',
      "Use raw MCP only for an explicitly requested native tool or an operation the browser tools do not support, such as page discovery, console/network diagnostics, screenshots, arbitrary JavaScript, or dragging. State why the native operation is needed. Native snapshots needed to obtain UIDs for those operations are allowed.",
      "Keep raw MCP operations on the same page and backend. Do not pass browser @eN aliases to raw MCP tools or native UIDs to browser_act. Take a fresh browser_snapshot before resuming browser actions after a raw operation changes the page.",
      "Report tool failures and workflow stop reasons. Do not bypass a denied or failed browser action, or a workflow confidence or authorization stop, with raw MCP. Do not replay a possibly completed action or silently switch backends.",
    ].join("\n");
  });
}
