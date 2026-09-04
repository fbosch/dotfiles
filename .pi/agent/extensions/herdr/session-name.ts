import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HerdrPaneClient } from "./client";

const AGENT = "pi";
const DIRECT_AGENT_SOURCE = "herdr:pi";
const EMBEDDED_AGENT_SOURCE = "custom:neovim-pi";
const METADATA_SOURCE = "user:pi-session-title";
const TITLE_TOKEN = "pi_session_title";

export class HerdrSessionNameIntegration {
  readonly #client: HerdrPaneClient;
  readonly #embedded: boolean;
  readonly #lifecycleSource: string;

  static fromEnvironment(): HerdrSessionNameIntegration | undefined {
    const {
      HERDR_ENV,
      HERDR_PANE_ID: directPaneId,
      HERDR_SOCKET_PATH: socketPath,
      PI_NVIM_HERDR_PANE_ID: embeddedPaneId,
    } = process.env;
    if (HERDR_ENV !== "1" || !socketPath) return undefined;

    if (embeddedPaneId) {
      return new HerdrSessionNameIntegration(
        embeddedPaneId,
        socketPath,
        "neovim-pi",
        EMBEDDED_AGENT_SOURCE,
        true,
      );
    }
    if (!directPaneId) return undefined;
    return new HerdrSessionNameIntegration(
      directPaneId,
      socketPath,
      AGENT,
      DIRECT_AGENT_SOURCE,
      false,
    );
  }

  private constructor(
    paneId: string,
    socketPath: string,
    agent: string,
    lifecycleSource: string,
    embedded: boolean,
  ) {
    this.#client = new HerdrPaneClient(paneId, socketPath, agent);
    this.#embedded = embedded;
    this.#lifecycleSource = lifecycleSource;
  }

  reportName(name: string | undefined): Promise<void> {
    const title = name?.trim() || null;
    return this.#client.request("pane.report_metadata", METADATA_SOURCE, {
      applies_to_source: this.#lifecycleSource,
      ...(this.#embedded ? { display_agent: "Pi" } : {}),
      tokens: { [TITLE_TOKEN]: title },
    });
  }

  shutdown(): Promise<void> {
    return this.#client.request("pane.report_metadata", METADATA_SOURCE, {
      applies_to_source: this.#lifecycleSource,
      ...(this.#embedded ? { clear_display_agent: true } : {}),
      tokens: { [TITLE_TOKEN]: null },
    });
  }
}

export default function herdrSessionName(pi: ExtensionAPI): void {
  const integration = HerdrSessionNameIntegration.fromEnvironment();
  if (!integration) return;

  let tuiSession = false;
  pi.on("session_start", (_event, ctx) => {
    // Herdr can only display interactive Pi sessions; RPC and print modes have no PTY UI.
    if (ctx.mode !== "tui") return;
    tuiSession = true;
    return integration.reportName(pi.getSessionName());
  });
  pi.on("agent_start", (_event, ctx) => {
    // Retry when startup handlers were delayed by the managed Herdr lifecycle reporter.
    if (ctx.mode !== "tui" || tuiSession) return;
    tuiSession = true;
    return integration.reportName(pi.getSessionName());
  });
  pi.on("session_info_changed", (event) => {
    if (!tuiSession) return;
    return integration.reportName(event.name);
  });
  pi.on("session_shutdown", () => {
    if (!tuiSession) return;
    tuiSession = false;
    return integration.shutdown();
  });
}
