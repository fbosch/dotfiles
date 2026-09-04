import net from "node:net";

export type HerdrPaneMethod = "pane.release_agent" | "pane.report_agent" | "pane.report_metadata";

export class HerdrPaneClient {
  readonly #agent: string;
  readonly #paneId: string;
  readonly #socketPath: string;
  #requestChain = Promise.resolve();
  #sequence = Date.now() * 1000;

  constructor(paneId: string, socketPath: string, agent: string) {
    this.#agent = agent;
    this.#paneId = paneId;
    this.#socketPath = socketPath;
  }

  request(
    method: HerdrPaneMethod,
    source: string,
    params: Record<string, unknown> = {},
    sequenced = true,
  ): Promise<void> {
    const sequence = ++this.#sequence;
    const request = {
      id: `${source}:${sequence}`,
      method,
      params: {
        pane_id: this.#paneId,
        source,
        agent: this.#agent,
        ...(sequenced ? { seq: sequence } : {}),
        ...params,
      },
    };
    const pending = this.#requestChain.then(() => this.#send(request));
    this.#requestChain = pending.catch(() => {});
    return pending;
  }

  async #send(request: object): Promise<void> {
    if (await this.#sendAttempt(request, 500)) return;
    await this.#sendAttempt(request, 1500);
  }

  #sendAttempt(request: object, timeoutMs: number): Promise<boolean> {
    const socketEndpoint =
      process.platform === "win32" ? `\\\\.\\pipe\\${this.#socketPath}` : this.#socketPath;

    return new Promise((resolve) => {
      let finished = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const client = net.createConnection(socketEndpoint);
      const finish = (delivered: boolean) => {
        if (finished) return;
        finished = true;
        if (timeout !== undefined) clearTimeout(timeout);
        client.destroy();
        resolve(delivered);
      };

      client.on("connect", () => client.write(`${JSON.stringify(request)}\n`));
      client.on("data", () => finish(true));
      client.on("end", () => finish(false));
      client.on("error", () => finish(false));
      client.on("close", () => finish(false));
      timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
    });
  }
}
