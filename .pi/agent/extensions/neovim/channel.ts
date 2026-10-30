import { createConnection, type Socket } from "node:net";
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

const MAX_FRAME_BYTES = 64 * 1024 + 2 * 1024;
const BIND_TIMEOUT_MS = 5000;
const bindingKeys = [
  "version",
  "channelId",
  "cwd",
  "editorPid",
  "launchId",
  "ownerId",
  "sessionId",
] as const;

interface PromptHandlers {
  readonly dispatch: (request: PromptRequest) => PromptAcknowledgement;
  readonly reject: (
    request: PromptRequestIdentity,
    code: PromptFailureCode,
    fingerprint?: string,
  ) => PromptAcknowledgement;
  readonly disconnect: () => void;
}

interface BindMessage {
  readonly version: 1;
  readonly type: "bind";
  readonly launchId: string;
  readonly cwd: string;
  readonly sessionId: string;
}

interface AckMessage {
  readonly version: 1;
  readonly type: "ack";
  readonly payload: PromptAcknowledgement;
}

interface CloseMessage {
  readonly version: 1;
  readonly type: "close";
}

type ClientMessage = BindMessage | AckMessage | CloseMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isServerError(value: Record<string, unknown>): boolean {
  return (
    hasOnlyKeys(value, ["version", "type", "code"]) &&
    value.version === 1 &&
    value.type === "error" &&
    (value.code === "bind-rejected" || value.code === "protocol-error")
  );
}

export class PiAskChannel {
  #socket: Socket | undefined;
  #binding: PromptBinding | undefined;
  #buffer = Buffer.alloc(0);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #openResolve: ((binding: PromptBinding) => void) | undefined;
  #openReject: ((error: Error) => void) | undefined;
  #openSettled = false;
  #disconnectNotified = false;

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

    this.#binding = undefined;
    this.#buffer = Buffer.alloc(0);
    this.#disconnectNotified = false;
    this.#openSettled = false;

    return new Promise((resolve, reject) => {
      this.#openResolve = resolve;
      this.#openReject = reject;
      try {
        const socket = createConnection(this.socketPath);
        this.#socket = socket;
        this.#timer = setTimeout(
          () => this.#fail(new Error("Pi Ask binding timed out")),
          BIND_TIMEOUT_MS,
        );
        socket.on("data", (chunk: Buffer) => {
          if (this.#socket === socket) this.#receive(chunk, cwd, sessionId);
        });
        socket.once("error", (error) => {
          if (this.#socket === socket) this.#fail(error);
        });
        socket.once("close", () => {
          if (this.#socket === socket) this.#fail(new Error("Pi Ask disconnected"));
        });
        socket.once("connect", () => {
          if (this.#socket !== socket) return;
          this.#write({
            version: 1,
            type: "bind",
            launchId: this.launchId,
            cwd,
            sessionId,
          });
        });
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): Promise<void> {
    const socket = this.#socket;
    if (socket === undefined) return Promise.resolve();
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.setTimeout(1000, () => socket.destroy());
    const frame = this.#binding !== undefined && socket.writable && !socket.destroyed
      ? this.#encode({ version: 1, type: "close" })
      : undefined;
    this.#finish(new Error("Pi Ask channel closed"), frame);
    return closed;
  }

  #receive(chunk: Buffer, cwd: string, sessionId: string): void {
    if (this.#socket === undefined) return;
    const combined = Buffer.concat([this.#buffer, chunk]);
    let start = 0;
    while (true) {
      const newline = combined.indexOf(0x0a, start);
      if (newline < 0) break;
      if (newline === start || newline - start > MAX_FRAME_BYTES) {
        this.#fail(new Error("Invalid or oversized Pi Ask frame"));
        return;
      }
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(combined.subarray(start, newline));
      } catch {
        this.#fail(new Error("Pi Ask sent invalid UTF-8"));
        return;
      }
      start = newline + 1;
      try {
        this.#receiveFrame(decoded, cwd, sessionId);
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error("Invalid Pi Ask notification"));
        return;
      }
      if (this.#socket === undefined) return;
    }
    this.#buffer = Buffer.from(combined.subarray(start));
    if (this.#buffer.length > MAX_FRAME_BYTES) this.#fail(new Error("Oversized Pi Ask frame"));
  }

  #receiveFrame(frame: string, cwd: string, sessionId: string): void {
    let value: unknown;
    try {
      value = JSON.parse(frame);
    } catch {
      this.#fail(new Error("Invalid Pi Ask message"));
      return;
    }
    if (!isRecord(value) || value.version !== 1 || typeof value.type !== "string") {
      this.#fail(new Error("Invalid Pi Ask message envelope"));
      return;
    }
    if (value.type === "error") {
      if (!isServerError(value)) {
        this.#fail(new Error("Invalid Pi Ask error envelope"));
        return;
      }
      this.#fail(
        new Error(value.code === "bind-rejected" ? "Pi Ask binding was rejected" : "Pi Ask protocol error"),
      );
      return;
    }

    if (this.#binding === undefined) {
      if (
        value.type !== "bound" ||
        !hasOnlyKeys(value, ["version", "type", "binding"]) ||
        !isRecord(value.binding) ||
        !hasOnlyKeys(value.binding, bindingKeys) ||
        value.binding.version !== 1 ||
        !isPositiveSafeInteger(value.binding.channelId) ||
        !isPositiveSafeInteger(value.binding.editorPid)
      ) {
        this.#fail(new Error("Invalid Pi Ask binding response"));
        return;
      }
      const binding = parsePromptBinding(value.binding, {
        channelId: value.binding.channelId,
        editorPid: value.binding.editorPid,
        cwd,
        launchId: this.launchId,
        sessionId,
      });
      if (binding === undefined) {
        this.#fail(new Error("Pi Ask binding does not match this session"));
        return;
      }
      this.#binding = binding;
      this.#settleOpen(binding);
      return;
    }

    if (
      value.type !== "prompt" ||
      !hasOnlyKeys(value, ["version", "type", "request"])
    ) {
      this.#fail(new Error("Unexpected Pi Ask message"));
      return;
    }
    const result = parsePromptNotification(PROMPT_NOTIFICATION, [value.request], cwd);
    if (result === undefined) {
      this.#fail(new Error("Invalid Pi Ask prompt"));
      return;
    }
    const acknowledgement = match(result)
      .with({ ok: true }, ({ value }) => this.handlers.dispatch(value))
      .with({ ok: false, identity: P.nonNullable }, ({ identity, error, fingerprint }) =>
        this.handlers.reject(identity, error, fingerprint),
      )
      .otherwise(() => undefined);
    if (acknowledgement === undefined) {
      this.#fail(new Error("Invalid Pi Ask prompt identity"));
      return;
    }
    this.#write({ version: 1, type: "ack", payload: acknowledgement });
  }

  #encode(message: ClientMessage): Buffer {
    const frame = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
    if (frame.length > MAX_FRAME_BYTES) throw new Error("Oversized Pi Ask frame");
    return frame;
  }

  #write(message: ClientMessage): void {
    const socket = this.#socket;
    if (socket === undefined || socket.destroyed || !socket.writable) {
      this.#fail(new Error("Pi Ask disconnected"));
      return;
    }
    let frame: Buffer;
    try {
      frame = this.#encode(message);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    socket.write(frame, (error?: Error | null) => {
      if (this.#socket === socket && error !== undefined && error !== null) this.#fail(error);
    });
  }

  #settleOpen(binding?: PromptBinding, error?: Error): void {
    if (this.#openSettled) return;
    this.#openSettled = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    const resolve = this.#openResolve;
    const reject = this.#openReject;
    this.#openResolve = undefined;
    this.#openReject = undefined;
    if (error !== undefined) reject?.(error);
    else if (binding !== undefined) resolve?.(binding);
  }

  #fail(error: Error): void {
    this.#finish(error);
  }

  #finish(error: Error, finalFrame?: Buffer): void {
    const socket = this.#socket;
    if (socket === undefined) {
      this.#settleOpen(undefined, error);
      return;
    }
    this.#socket = undefined;
    this.#binding = undefined;
    this.#buffer = Buffer.alloc(0);
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#settleOpen(undefined, error);
    if (finalFrame !== undefined && !socket.destroyed) socket.end(finalFrame);
    else socket.destroy();
    if (!this.#disconnectNotified) {
      this.#disconnectNotified = true;
      this.handlers.disconnect();
    }
  }
}
