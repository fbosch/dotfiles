import type {
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";

export function withToolExecution(context: ExtensionContext): ExtensionToolContext {
  return {
    ...context,
    tools: [],
    executeTool: async () => {
      throw new Error("Nested tool execution is not configured in this fixture");
    },
  };
}
