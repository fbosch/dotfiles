import { createConnection, type Socket } from "node:net";
import { attach, type NeovimClient } from "neovim";
import type { Logger } from "neovim/lib/utils/logger";
import { match, P } from "ts-pattern";
import { canonicalPath } from "./contracts";
import {
  PROMPT_NOTIFICATION,
  type PromptAcknowledgement,
  type PromptBinding,
  type PromptFailureCode,
  type PromptRequest,
  type PromptRequestIdentity,
  parsePromptBinding,
  parsePromptNotification,
} from "./prompt-protocol";

interface PromptHandlers {
  readonly dispatch: (request: PromptRequest) => PromptAcknowledgement;
  readonly reject: (
    request: PromptRequestIdentity,
    code: PromptFailureCode,
    fingerprint?: string,
  ) => PromptAcknowledgement;
  readonly disconnect: () => void;
}

// neovim@5's default Winston logger patches console and loads CJS transports that Pi cannot resolve.
const silentLogger = {
  level: "error",
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as Logger;
const integration = 'require("plugins.ai.pi")';

export class PiAskChannel {
  #socket: Socket | undefined;
  #client: NeovimClient | undefined;
  #binding: PromptBinding | undefined;
  #cancel: ((error: Error) => void) | undefined;

  constructor(
    readonly socketPath: string,
    readonly cwd: string,
    readonly launchId: string,
    readonly handlers: PromptHandlers,
  ) {}

  binding(): PromptBinding | undefined {
    return this.#binding;
  }

  open(sessionId: string): Promise<PromptBinding> {
    if (this.#socket !== undefined) throw new Error("Pi Ask channel already open");
    const cwd = canonicalPath(this.cwd);
    if (cwd === undefined) return Promise.reject(new Error("Pi Ask worktree is unavailable"));
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      this.#socket = socket;
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
        this.close();
      };
      this.#cancel = fail;
      const timer = setTimeout(() => fail(new Error("Pi Ask RPC binding timed out")), 5000);
      socket.on("error", fail);
      socket.once("close", () => fail(new Error("Pi Ask RPC disconnected")));
      socket.once("connect", () => {
        const client = attach({
          reader: socket,
          writer: socket,
          options: { logger: silentLogger },
        });
        this.#client = client;
        const pending: unknown[][] = [];
        const receive = (args: unknown[]) => {
          try {
            if (this.#socket !== socket) return;
            // RPC notifications can arrive in the same chunk as the binding response.
            if (this.#binding === undefined) {
              if (pending.length >= 32) throw new Error("Pi Ask notification queue is full");
              pending.push(args);
              return;
            }
            const result = parsePromptNotification(PROMPT_NOTIFICATION, args, cwd);
            if (result === undefined) throw new Error("Invalid Pi Ask prompt");
            const acknowledgement = match(result)
              .with({ ok: true }, ({ value }) => this.handlers.dispatch(value))
              .with({ ok: false, identity: P.nonNullable }, ({ identity, error, fingerprint }) =>
                this.handlers.reject(identity, error, fingerprint),
              )
              .otherwise(() => undefined);
            if (acknowledgement === undefined) throw new Error("Invalid Pi Ask prompt identity");
            client.notify("nvim_exec_lua", [
              `local payload, channel = ...; return ${integration}.prompt_acknowledge(payload, channel)`,
              [acknowledgement, this.#binding.channelId],
            ]);
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Invalid Pi Ask notification"));
          }
        };
        client.on("notification", (method: string, args: unknown[]) => {
          if (method === PROMPT_NOTIFICATION) receive(args);
        });
        const bind = async () => {
          const channelId = await client.channelId;
          const editorPid: unknown = await client.request("nvim_eval", ["getpid()"]);
          if (typeof editorPid !== "number" || !Number.isSafeInteger(editorPid) || editorPid < 1)
            throw new Error("Invalid Neovim editor identity");
          const value: unknown = await client.request("nvim_exec_lua", [
            `return ${integration}.bind_session(...)`,
            [
              {
                channelId,
                cwd,
                editorPid,
                launchId: this.launchId,
                sessionId,
                replacePending: true,
              },
            ],
          ]);
          if (this.#socket !== socket) return;
          const binding = parsePromptBinding(value, {
            channelId,
            cwd,
            editorPid,
            launchId: this.launchId,
            sessionId,
          });
          if (binding === undefined)
            throw new Error("Pi Ask RPC binding does not match this session");
          this.#binding = binding;
          clearTimeout(timer);
          resolve(binding);
          for (const args of pending.splice(0)) receive(args);
        };
        bind().catch(fail);
      });
    });
  }

  close(): void {
    const socket = this.#socket;
    if (socket === undefined) return;
    this.#socket = undefined;
    const binding = this.#binding;
    this.#binding = undefined;
    const client = this.#client;
    this.#client = undefined;
    if (binding !== undefined && client !== undefined && !socket.destroyed) {
      client.notify("nvim_exec_lua", [
        `return ${integration}.prompt_channel_closed(...)`,
        [binding.channelId],
      ]);
      socket.end();
    } else {
      socket.destroy();
    }
    const cancel = this.#cancel;
    this.#cancel = undefined;
    cancel?.(new Error("Pi Ask channel closed"));
    this.handlers.disconnect();
  }
}
