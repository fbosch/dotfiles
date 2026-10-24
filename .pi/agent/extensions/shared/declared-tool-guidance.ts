import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type RenderGuidance = (declaredTools: ReadonlySet<string>, context: ExtensionContext) => string;

export function registerDeclaredToolGuidance(
  pi: ExtensionAPI,
  section: string,
  render: RenderGuidance,
): void {
  pi.on("before_agent_start", (event, context) => {
    const options = event.systemPromptOptions;
    const hidden = new Set(options.hiddenTools);
    const declared = new Set(options.selectedTools.filter((name) => !hidden.has(name)));
    options.sections[section] = render(declared, context);
  });

  // Discovery changes declarations within a run, without another before_agent_start.
  // Append a request-local section delta so the original tool-load boundary stays intact.
  pi.on("context_with_system", (event, context) => {
    const state = getCurrentSystemMessage(event.messages);
    if (state === undefined) return;
    const declared = new Set((state.toolsAdded ?? []).map((tool) => tool.name));
    const body = render(declared, context);
    const content = body ? `<${section}>\n${body}\n</${section}>` : null;
    if ((state.sections?.[section] ?? null) === content) return;
    return {
      messages: [
        ...event.messages,
        {
          role: "system" as const,
          content: "",
          sections: { [section]: content },
          timestamp: Date.now(),
        },
      ],
    };
  });
}
