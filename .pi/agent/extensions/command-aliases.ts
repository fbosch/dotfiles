import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CommandAlias {
  trigger: string;
  target: string;
  description: string;
}

const COMMAND_ALIASES: readonly CommandAlias[] = [
  {
    trigger: "/exit",
    target: "/quit",
    description: "Quit pi",
  },
];

export function getCommandAlias(input: string): CommandAlias | undefined {
  return COMMAND_ALIASES.find((alias) => alias.trigger === input);
}

export default function commandAliases(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (getCommandAlias(event.text) === undefined) return;

    ctx.shutdown();
    return { action: "handled" };
  });
}
