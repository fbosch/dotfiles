import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readContextUsageFromContext,
  type StartupContextUsage,
} from "./startup-header/context-usage";
import { installStartupOwnerPublisher } from "./startup-header/publisher";

export default function contextViewStartupPublisher(pi: ExtensionAPI): void {
  let usage: StartupContextUsage | undefined;
  const current = () =>
    usage === undefined
      ? { state: "unavailable" as const }
      : { state: "ready" as const, payload: usage };
  const publisher = installStartupOwnerPublisher(pi.events, "context", current);

  const refresh = (ctx: ExtensionContext) => {
    usage = readContextUsageFromContext(ctx);
    publisher.publish(current());
  };

  pi.on("session_start", (_event, ctx) => refresh(ctx));
  pi.on("agent_start", (_event, ctx) => refresh(ctx));
  pi.on("agent_end", (_event, ctx) => refresh(ctx));
  pi.on("model_select", (_event, ctx) => refresh(ctx));
  pi.on("session_compact", (_event, ctx) => refresh(ctx));
  pi.on("session_compact_failed", (_event, ctx) => refresh(ctx));
  pi.on("session_shutdown", () => {
    usage = undefined;
    publisher.dispose();
  });
}
