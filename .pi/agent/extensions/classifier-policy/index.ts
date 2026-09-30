import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installClassifierGate } from "../../lib/classifier";

export default function classifierPolicyExtension(pi: ExtensionAPI): void {
  let restore: (() => void) | undefined;
  const bind = (_event: unknown, ctx: ExtensionContext) => {
    restore?.();
    restore = installClassifierGate(ctx.modelRegistry, ctx);
  };

  pi.on("session_start", bind);
  pi.on("before_agent_start", bind);
  pi.on("tool_call", bind);
  pi.on("session_shutdown", () => {
    restore?.();
    restore = undefined;
  });
}
