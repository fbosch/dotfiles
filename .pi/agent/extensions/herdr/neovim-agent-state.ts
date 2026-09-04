import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HerdrPaneClient } from "./client";

// A distinct label lets release_agent clear Herdr's cached identity while Neovim stays alive.
const AGENT = "neovim-pi";
const BLOCKED_CHANNEL = "herdr:blocked";
const SOURCE = "custom:neovim-pi";

type AgentState = "blocked" | "idle" | "working";

interface BlockedEvent {
  readonly active: boolean;
  readonly label?: string;
}

function blockedEvent(data: unknown): BlockedEvent | undefined {
  if (typeof data !== "object" || data === null || !("active" in data)) return undefined;
  const { active, label } = data as { active: unknown; label?: unknown };
  if (typeof active !== "boolean") return undefined;
  return {
    active,
    ...(typeof label === "string" ? { label } : {}),
  };
}

class EmbeddedHerdrLifecycle {
  readonly #client: HerdrPaneClient;
  #lastMessage: string | undefined;
  #lastState: AgentState | undefined;

  static fromEnvironment(): EmbeddedHerdrLifecycle | undefined {
    const {
      HERDR_ENV,
      HERDR_PANE_ID: directPaneId,
      HERDR_SOCKET_PATH: socketPath,
      PI_NVIM_HERDR_PANE_ID: embeddedPaneId,
    } = process.env;
    if (HERDR_ENV !== "1" || directPaneId || !embeddedPaneId || !socketPath) return undefined;
    return new EmbeddedHerdrLifecycle(embeddedPaneId, socketPath);
  }

  private constructor(paneId: string, socketPath: string) {
    this.#client = new HerdrPaneClient(paneId, socketPath, AGENT);
  }

  report(state: AgentState, message?: string, force = false): void {
    if (!force && state === this.#lastState && message === this.#lastMessage) return;
    this.#lastState = state;
    this.#lastMessage = message;
    void this.#client.request("pane.report_agent", SOURCE, { state, message });
  }

  release(): Promise<void> {
    this.#lastState = undefined;
    this.#lastMessage = undefined;
    return this.#client.request("pane.release_agent", SOURCE);
  }
}

export default function herdrNeovimAgentState(pi: ExtensionAPI): void {
  const integration = EmbeddedHerdrLifecycle.fromEnvironment();
  if (!integration) return;

  let agentActive = false;
  let blockedCount = 0;
  let blockedMessage: string | undefined;
  let rootSession = false;

  function publish(force = false): void {
    if (blockedCount > 0) {
      integration?.report("blocked", blockedMessage, force);
    } else {
      integration?.report(agentActive ? "working" : "idle", undefined, force);
    }
  }

  const disposeBlocked = pi.events.on(BLOCKED_CHANNEL, (data) => {
    if (!rootSession) return;

    const event = blockedEvent(data);
    if (event === undefined) return;
    if (event.active) {
      blockedCount += 1;
      blockedMessage = event.label;
    } else {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) blockedMessage = undefined;
    }
    publish();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    rootSession = true;
    agentActive = ctx.isIdle() === false;
    publish(true);
  });
  pi.on("agent_start", () => {
    if (!rootSession) return;
    agentActive = true;
    publish();
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (!rootSession || ctx.isIdle() !== true) return;
    agentActive = false;
    publish();
  });
  pi.on("session_shutdown", () => {
    if (!rootSession) return;
    rootSession = false;
    blockedCount = 0;
    blockedMessage = undefined;
    disposeBlocked();
    return integration.release();
  });
}
