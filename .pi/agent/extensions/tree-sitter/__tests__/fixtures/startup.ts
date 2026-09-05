import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { plugin } from "bun";

plugin({
  name: "reject-eager-tree-sitter",
  setup(build) {
    build.onResolve({ filter: /web-tree-sitter/ }, () => {
      throw new Error("tree-sitter runtime imported during registration");
    });
  },
});

const { default: initialize } = await import("../../index");
const tools: string[] = [];
const events: string[] = [];
const initialized = initialize({
  on(name: string) {
    events.push(name);
  },
  registerTool(tool: { name: string }) {
    tools.push(tool.name);
  },
} as unknown as ExtensionAPI);
if (tools.length !== 5 || !events.includes("tool_call")) {
  throw new Error("registration was deferred");
}
await initialized;
console.log(JSON.stringify(tools));
