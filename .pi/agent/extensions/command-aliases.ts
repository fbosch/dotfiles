import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMAND_ALIASES = new Map([["/exit", "/quit"]]);

export function resolveCommandAlias(input: string): string {
  return COMMAND_ALIASES.get(input) ?? input;
}

export default function commandAliases(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (resolveCommandAlias(event.text) === event.text) return;

    ctx.shutdown();
    return { action: "handled" };
  });
}
