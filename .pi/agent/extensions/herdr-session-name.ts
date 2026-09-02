import net from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGENT = "pi";
const AGENT_SOURCE = "herdr:pi";
const METADATA_SOURCE = "user:pi-session-title";
const TITLE_TOKEN = "pi_session_title";

type HerdrMethod = "pane.report_metadata";

export class HerdrSessionNameIntegration {
  readonly #paneId: string;
  readonly #socketPath: string;
  #sequence = Date.now() * 1000;
  #requestChain = Promise.resolve();

  static fromEnvironment(): HerdrSessionNameIntegration | undefined {
    const { HERDR_ENV, HERDR_PANE_ID: paneId, HERDR_SOCKET_PATH: socketPath } = process.env;
    if (HERDR_ENV !== "1" || !paneId || !socketPath) return undefined;
    return new HerdrSessionNameIntegration(paneId, socketPath);
  }

  private constructor(paneId: string, socketPath: string) {
    this.#paneId = paneId;
    this.#socketPath = socketPath;
  }

  reportName(name: string | undefined): Promise<void> {
    const title = name?.trim() || null;
    const pending = this.#request("pane.report_metadata", {
      applies_to_source: AGENT_SOURCE,
      tokens: { [TITLE_TOKEN]: title },
    });
    this.#requestChain = pending.catch(() => {});
    return pending;
  }

  #request(method: HerdrMethod, params: Record<string, unknown>): Promise<void> {
    const sequence = ++this.#sequence;
    const request = {
      id: `${METADATA_SOURCE}:${sequence}`,
      method,
      params: {
        pane_id: this.#paneId,
        source: METADATA_SOURCE,
        agent: AGENT,
        seq: sequence,
        ...params,
      },
    };
    const pending = this.#requestChain.then(() => this.#requestOnce(request));
    return pending;
  }

  #requestOnce(request: object): Promise<void> {
    const socketEndpoint =
      process.platform === "win32" ? `\\\\.\\pipe\\${this.#socketPath}` : this.#socketPath;

    return new Promise((resolve) => {
      const client = net.createConnection(socketEndpoint, () => {
        client.write(`${JSON.stringify(request)}\n`);
      });
      const finish = () => {
        client.destroy();
        resolve();
      };
      client.setTimeout(500, finish);
      client.on("data", finish);
      client.on("error", finish);
      client.on("end", finish);
      client.on("close", resolve);
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
}
