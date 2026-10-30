import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NeovimStartupPayload } from "../startup-header/owner-payloads";
import { installStartupOwnerPublisher, type StartupOwnerStatus } from "../startup-header/publisher";
import { PiAskChannel } from "./channel";
import { PromptRequestDispatcher } from "./prompt-protocol";

export interface NeovimExtensionDependencies {
  readonly launchId?: string;
  readonly socketPath?: string;
}

export function initializeNeovim(
  pi: ExtensionAPI,
  dependencies: { readonly socketPath: string; readonly launchId: string },
): void {
  let activeContext: ExtensionContext | undefined;
  let channel: PiAskChannel | undefined;
  let blockingPromptActive = false;
  let startupStatus: StartupOwnerStatus<NeovimStartupPayload> = { state: "unavailable" };
  const publisher =
    typeof pi.events?.on === "function"
      ? installStartupOwnerPublisher(pi.events, "neovim", () => startupStatus)
      : undefined;
  const publish = (status: StartupOwnerStatus<NeovimStartupPayload>) => {
    startupStatus = status;
    publisher?.publish(status);
  };
  const dispatcher = new PromptRequestDispatcher(pi, {
    binding: () => channel?.binding(),
    blockingPromptActive: () => blockingPromptActive,
    context: () => activeContext,
  });

  pi.on("session_start", async (_event, context) => {
    if (context.mode !== "tui") return;
    activeContext = context;
    blockingPromptActive = false;
    publish({ state: "collecting" });
    const previous = channel;
    const current = new PiAskChannel(dependencies.socketPath, context.cwd, dependencies.launchId, {
      dispatch: (request) => dispatcher.dispatch(request),
      reject: (request, code, fingerprint) =>
        dispatcher.rejectMalformed(request, code, fingerprint),
      disconnect: () => {
        if (channel === current) {
          publish({ state: "degraded", payload: { problem: "channel-problem" } });
        }
      },
    });
    channel = current;
    try {
      await previous?.close();
      if (channel !== current) return;
      await current.open(context.sessionManager.getSessionId());
      if (channel === current) publish({ state: "ready", observedAt: Date.now() });
    } catch (error) {
      if (channel !== current) return;
      publish({ state: "degraded", payload: { problem: "channel-problem" } });
      context.ui.notify(
        `Pi Ask could not connect: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });
  pi.on("ui_prompt_start", () => {
    blockingPromptActive = true;
  });
  pi.on("ui_prompt_end", () => {
    blockingPromptActive = false;
  });
  pi.on("session_shutdown", () => {
    const current = channel;
    channel = undefined;
    activeContext = undefined;
    blockingPromptActive = false;
    publisher?.dispose();
    return current?.close();
  });
}
