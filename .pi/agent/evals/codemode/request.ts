function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block) => (record(block) && typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

export function inspectProviderRequest(payload: unknown): {
  instructions: string;
  tools: Array<{ name: string; description: string }>;
} {
  if (!record(payload)) return { instructions: "", tools: [] };
  const instructions = [contentText(payload.instructions), contentText(payload.system)];
  for (const messages of [payload.messages, payload.input]) {
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (record(message) && (message.role === "system" || message.role === "developer"))
        instructions.push(contentText(message.content));
    }
  }
  const declarations: unknown[] = Array.isArray(payload.tools) ? [...payload.tools] : [];
  for (const messages of [payload.input, payload.messages]) {
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (record(message) && message.type === "additional_tools" && Array.isArray(message.tools))
        declarations.push(...message.tools);
    }
  }
  const tools = declarations.flatMap((tool) => {
    if (!record(tool)) return [];
    const definition = record(tool.function) ? tool.function : tool;
    return typeof definition.name === "string"
      ? [
          {
            name: definition.name,
            description: typeof definition.description === "string" ? definition.description : "",
          },
        ]
      : [];
  });
  return { instructions: instructions.filter(Boolean).join("\n\n"), tools };
}

export const directRoutingHint =
  "Routing: Use this tool from codemode when it belongs to a task needing multiple tool calls. " +
  "Start independent calls together with Promise.allSettled. " +
  "Call this tool directly only for a single trivial tool call or an explicit direct-tool request.";

export const codemodeRoutingHint =
  "Routing: Use codemode for a task needing multiple tool calls. " +
  "Batch independent calls with Promise.allSettled and await prerequisites in order. " +
  "For one trivial call, use that tool directly. Honor explicit direct-tool requests.";

type ProviderRequestPayload = Record<string, unknown>;
type ProviderToolDeclaration = Record<string, unknown>;
type ProviderInputMessage = Record<string, unknown>;

export function addToolRoutingGuidance(payload: unknown): ProviderRequestPayload | null {
  if (!record(payload)) return null;
  const updateTool = (tool: unknown): ProviderToolDeclaration => {
    if (!record(tool)) throw new Error("Tool declarations must be objects");
    const nested = record(tool.function);
    const definition = nested ? tool.function : tool;
    if (!record(definition) || typeof definition.name !== "string") return tool;
    const hint = definition.name === "codemode" ? codemodeRoutingHint : directRoutingHint;
    const original = typeof definition.description === "string" ? definition.description : "";
    const description = `${hint}\n\n${original}`;
    return nested
      ? { ...tool, function: { ...definition, description } }
      : { ...tool, description };
  };
  const updateMessages = (messages: unknown[]): ProviderInputMessage[] =>
    messages.map((message) => {
      if (!record(message)) throw new Error("Provider messages must be objects");
      return message.type === "additional_tools" && Array.isArray(message.tools)
        ? { ...message, tools: message.tools.map(updateTool) }
        : message;
    });
  return {
    ...payload,
    ...(Array.isArray(payload.tools) ? { tools: payload.tools.map(updateTool) } : {}),
    ...(Array.isArray(payload.input) ? { input: updateMessages(payload.input) } : {}),
    ...(Array.isArray(payload.messages) ? { messages: updateMessages(payload.messages) } : {}),
  };
}
