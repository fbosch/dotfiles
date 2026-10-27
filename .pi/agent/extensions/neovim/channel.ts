import { createConnection, type Socket } from "node:net";
import { isMatching, P } from "ts-pattern";
import { canonicalPath } from "./contracts";
import {
  MAX_PROMPT_REQUEST_BYTES,
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

export class PiAskChannel {
  #socket: Socket | undefined;
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
    if (cwd === undefined) throw new Error("Pi Ask worktree is unavailable");
    return new Promise((resolve, reject) => {
      let buffered = Buffer.alloc(0);
      const socket = createConnection(this.socketPath);
      this.#socket = socket;
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
        this.close();
      };
      this.#cancel = fail;
      const timer = setTimeout(() => fail(new Error("Pi Ask broker binding timed out")), 5000);
      socket.once("connect", () => {
        socket.write(
          `${JSON.stringify({ type: "bind", version: 1, launchId: this.launchId, sessionId, cwd })}\n`,
        );
      });
      socket.on("error", fail);
      socket.once("close", () => fail(new Error("Pi Ask broker disconnected")));
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        let newline = buffered.indexOf(10);
        while (newline !== -1 && this.#socket === socket) {
          if (newline >= MAX_PROMPT_REQUEST_BYTES) {
            fail(new Error("Pi Ask broker frame exceeds 64 KiB"));
            return;
          }
          const frame = buffered.subarray(0, newline);
          buffered = buffered.subarray(newline + 1);
          try {
            const message: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(frame),
            );
            if (this.#binding === undefined) {
              if (
                !isMatching(
                  { type: "bound", binding: { channelId: P.number, editorPid: P.number } },
                  message,
                )
              ) {
                throw new Error("Invalid Pi Ask broker binding");
              }
              const { channelId, editorPid } = message.binding;
              if (
                !Number.isSafeInteger(channelId) ||
                channelId < 1 ||
                !Number.isSafeInteger(editorPid) ||
                editorPid < 1
              ) {
                throw new Error("Invalid Pi Ask broker identity");
              }
              const binding = parsePromptBinding(message.binding, {
                channelId,
                cwd,
                editorPid,
                launchId: this.launchId,
                sessionId,
              });
              if (binding === undefined)
                throw new Error("Pi Ask broker identity does not match this session");
              this.#binding = binding;
              clearTimeout(timer);
              resolve(binding);
            } else {
              if (!isMatching({ type: "prompt", request: P.nonNullable }, message)) {
                throw new Error("Invalid Pi Ask broker message");
              }
              const result = parsePromptNotification(PROMPT_NOTIFICATION, [message.request], cwd);
              if (result === undefined) throw new Error("Invalid Pi Ask prompt");
              const acknowledgement = result.ok
                ? this.handlers.dispatch(result.value)
                : result.identity === undefined
                  ? undefined
                  : this.handlers.reject(result.identity, result.error, result.fingerprint);
              if (acknowledgement === undefined) throw new Error("Invalid Pi Ask prompt identity");
              socket.write(`${JSON.stringify({ type: "ack", payload: acknowledgement })}\n`);
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Invalid Pi Ask broker frame"));
            return;
          }
          newline = buffered.indexOf(10);
        }
        if (buffered.length >= MAX_PROMPT_REQUEST_BYTES)
          fail(new Error("Pi Ask broker frame exceeds 64 KiB"));
      });
    });
  }

  close(): void {
    const socket = this.#socket;
    if (socket === undefined) return;
    this.#socket = undefined;
    this.#binding = undefined;
    const cancel = this.#cancel;
    this.#cancel = undefined;
    socket.destroy();
    cancel?.(new Error("Pi Ask channel closed"));
    this.handlers.disconnect();
  }
}
