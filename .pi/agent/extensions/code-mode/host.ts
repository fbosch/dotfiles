import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const STDERR_LIMIT_BYTES = 8 * 1024;

interface ToolSourceInfo {
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir?: string;
}

export interface CodeModeTool {
  name: string;
  description: string;
  inputSchema: unknown;
  sourceInfo: ToolSourceInfo;
}

export interface NestedToolValue {
  value: unknown;
  terminate?: boolean;
}

export interface CodeModeOutputItem {
  type: "input_text" | "input_image" | "input_audio";
  text?: string;
  image_url?: string;
  audio_url?: string;
}

export interface CodeModeExecutionResult {
  contentItems: CodeModeOutputItem[];
  errorText?: string;
  hostDurationNs: number;
  nestedToolCalls: number;
  terminate: boolean;
}

export interface CodeModeExecutionOptions {
  source: string;
  toolCallId: string;
  tools: readonly CodeModeTool[];
  signal: AbortSignal;
  hostCommand?: string;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
  maxNestedToolCalls?: number;
  invokeTool: (tool: CodeModeTool, input: unknown, signal: AbortSignal) => Promise<NestedToolValue>;
  onNotification?: (text: string) => void;
}

interface PendingFrame {
  resolve: (frame: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

class FramedHost {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private frames: unknown[] = [];
  private pending: PendingFrame | undefined;
  private failure?: Error;
  private stderr = Buffer.alloc(0);
  private writeQueue = Promise.resolve();

  constructor(command: string) {
    this.child = spawn(command, ["--listen", "stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "" },
    });

    this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = Buffer.concat([this.stderr, chunk]).subarray(-STDERR_LIMIT_BYTES);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", (code, signal) => {
      if (!this.failure) {
        const diagnostic = this.stderr.toString("utf8").trim();
        this.fail(
          new Error(
            `Code Mode host exited before completing the request (code ${String(code)}, signal ${String(signal)})${diagnostic ? `: ${diagnostic}` : ""}`,
          ),
        );
      }
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_FRAME_BYTES) {
        this.fail(new Error(`Code Mode host frame exceeds ${MAX_FRAME_BYTES} bytes.`));
        return;
      }
      if (this.buffer.length < length + 4) return;

      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      try {
        this.push(JSON.parse(payload.toString("utf8")));
      } catch (error) {
        this.fail(
          new Error(
            `Code Mode host returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }
    }
  }

  private push(frame: unknown): void {
    if (!this.pending) {
      this.frames.push(frame);
      return;
    }
    const pending = this.pending;
    this.pending = undefined;
    pending.cleanup();
    pending.resolve(frame);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending.cleanup();
      pending.reject(error);
    }
  }

  send(message: unknown): Promise<void> {
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > MAX_FRAME_BYTES) {
      return Promise.reject(new Error(`Code Mode client frame exceeds ${MAX_FRAME_BYTES} bytes.`));
    }

    const frame = Buffer.allocUnsafe(payload.length + 4);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);

    const write = this.writeQueue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.child.stdin.write(frame, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    this.writeQueue = write.catch(() => undefined);
    return write;
  }

  next(signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.frames.length > 0) return Promise.resolve(this.frames.shift());
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) {
      return Promise.reject(new Error("Code Mode host already has a pending frame reader."));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (this.pending?.reject !== reject) return;
        this.pending = undefined;
        reject(signal.reason instanceof Error ? signal.reason : new Error("Code Mode cancelled."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", onAbort),
      };
    });
  }

  stop(): void {
    this.child.kill("SIGKILL");
  }
}

interface RuntimeResponse {
  kind: "Yielded" | "Terminated" | "Result";
  cellId: string;
  contentItems: CodeModeOutputItem[];
  errorText?: string;
  hostDurationNs: number;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Code Mode host returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function unwrapResult(value: unknown, label: string): unknown {
  const result = objectValue(value, label);
  if (result.status === "error") {
    throw new Error(typeof result.message === "string" ? result.message : `${label} failed.`);
  }
  if (result.status !== "ok" || !("value" in result)) {
    throw new Error(`Code Mode host returned an invalid ${label}.`);
  }
  return result.value;
}

function parseRuntimeResponse(value: unknown): RuntimeResponse {
  const wrapper = objectValue(value, "runtime response");
  const variants = ["Yielded", "Terminated", "Result"] as const;
  const kind = variants.find((candidate) => candidate in wrapper);
  if (!kind) throw new Error("Code Mode host returned an unknown runtime response.");

  const payload = objectValue(wrapper[kind], `${kind} runtime response`);
  if (typeof payload.cell_id !== "string" || !Array.isArray(payload.content_items)) {
    throw new Error(`Code Mode host returned an invalid ${kind} runtime response.`);
  }

  return {
    kind,
    cellId: payload.cell_id,
    contentItems: payload.content_items as CodeModeOutputItem[],
    ...(typeof payload.error_text === "string" ? { errorText: payload.error_text } : {}),
    hostDurationNs:
      typeof payload.code_mode_host_duration_ns === "number"
        ? payload.code_mode_host_duration_ns
        : 0,
  };
}

function responseType(value: unknown, expected: string): Record<string, unknown> {
  const response = objectValue(value, "operation response");
  if (response.type !== expected) {
    throw new Error(`Code Mode host returned ${String(response.type)}; expected ${expected}.`);
  }
  return response;
}

export async function executeCodeMode(
  options: CodeModeExecutionOptions,
): Promise<CodeModeExecutionResult> {
  const host = new FramedHost(options.hostCommand ?? "codex-code-mode-host");
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const delegateControllers = new Map<number, AbortController>();
  const maxNestedToolCalls = options.maxNestedToolCalls ?? 64;
  const yieldTimeMs = options.yieldTimeMs ?? 1_000;
  let nestedToolCalls = 0;
  let terminate = false;
  let requestId = 0;
  let delegateQueue = Promise.resolve();

  const abortHost = () => {
    for (const controller of delegateControllers.values()) controller.abort(options.signal.reason);
    host.stop();
  };
  options.signal.addEventListener("abort", abortHost, { once: true });

  const respondToDelegate = (id: number, result: unknown): Promise<void> =>
    host.send({ type: "delegate/response", id, result });

  const handleDelegate = (message: Record<string, unknown>): void => {
    if (typeof message.id !== "number") throw new Error("Code Mode delegate request has no ID.");
    const id = message.id;
    const request = objectValue(message.request, "delegate request");

    if (request.type === "notification/send") {
      if (typeof request.text === "string") options.onNotification?.(request.text);
      void respondToDelegate(id, {
        status: "ok",
        value: { type: "notification/delivered" },
      }).catch(() => undefined);
      return;
    }
    if (request.type !== "tool/invoke") {
      void respondToDelegate(id, {
        status: "error",
        message: `Unsupported Code Mode delegate: ${String(request.type)}`,
      }).catch(() => undefined);
      return;
    }

    const invocation = objectValue(request.invocation, "nested tool invocation");
    const toolName = objectValue(invocation.tool_name, "nested tool name").name;
    if (typeof toolName !== "string") {
      void respondToDelegate(id, {
        status: "error",
        message: "Nested tool name is invalid.",
      }).catch(() => undefined);
      return;
    }

    const tool = tools.get(toolName);
    const controller = new AbortController();
    delegateControllers.set(id, controller);
    const callNumber = ++nestedToolCalls;

    const run = delegateQueue.then(async () => {
      if (!tool) throw new Error(`Tool is not enabled for Code Mode: ${toolName}`);
      if (callNumber > maxNestedToolCalls) {
        throw new Error(`Code Mode exceeded ${maxNestedToolCalls} nested tool calls.`);
      }
      const result = await options.invokeTool(tool, invocation.input ?? {}, controller.signal);
      terminate ||= result.terminate === true;
      await respondToDelegate(id, {
        status: "ok",
        value: { type: "tool/result", result: result.value },
      });
    });
    delegateQueue = run
      .catch(async (error) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        await respondToDelegate(id, {
          status: "error",
          message: message.slice(0, STDERR_LIMIT_BYTES),
        }).catch(() => undefined);
      })
      .finally(() => {
        delegateControllers.delete(id);
      });
  };

  const nextProtocolMessage = async (signal: AbortSignal): Promise<Record<string, unknown>> => {
    for (;;) {
      const message = objectValue(await host.next(signal), "host message");
      if (message.type === "delegate/request") {
        handleDelegate(message);
        continue;
      }
      if (message.type === "delegate/cancel") {
        if (typeof message.id === "number") delegateControllers.get(message.id)?.abort();
        continue;
      }
      if (message.type === "cell/closed") continue;
      return message;
    }
  };

  const operation = async (
    request: Record<string, unknown>,
    expectedType: string,
    signal = options.signal,
  ): Promise<Record<string, unknown>> => {
    const id = ++requestId;
    await host.send({ type: "operation/request", id, request });
    for (;;) {
      const message = await nextProtocolMessage(signal);
      if (message.type !== "operation/response" || message.id !== id) {
        throw new Error(`Code Mode host returned an unexpected ${String(message.type)} message.`);
      }
      return responseType(unwrapResult(message.result, expectedType), expectedType);
    }
  };

  try {
    await host.send({
      type: "connection/hello",
      supportedVersions: [1],
      requiredCapabilities: [],
      optionalCapabilities: [],
    });
    const hello = await nextProtocolMessage(options.signal);
    if (hello.type === "connection/rejected") {
      throw new Error(
        `Code Mode host rejected protocol version 1: ${JSON.stringify(hello.reason)}`,
      );
    }
    if (hello.type !== "connection/ready" || hello.selectedVersion !== 1) {
      throw new Error("Code Mode host did not negotiate protocol version 1.");
    }

    const sessionId = crypto.randomUUID();
    await operation({ method: "session/open", sessionId }, "session/ready");

    const executeId = ++requestId;
    await host.send({
      type: "operation/request",
      id: executeId,
      request: {
        method: "session/execute",
        sessionId,
        request: {
          tool_call_id: options.toolCallId,
          enabled_tools: options.tools.map((tool) => ({
            name: tool.name,
            tool_name: { name: tool.name, namespace: null },
            description: tool.description,
            kind: "function",
            input_schema: tool.inputSchema,
            output_schema: null,
          })),
          source: options.source,
          yield_time_ms: yieldTimeMs,
          max_output_tokens: options.maxOutputTokens ?? 12_000,
        },
      },
    });

    let started = false;
    let runtime: RuntimeResponse | undefined;
    while (!started || !runtime) {
      const message = await nextProtocolMessage(options.signal);
      if (message.type === "operation/response" && message.id === executeId) {
        responseType(unwrapResult(message.result, "execution/started"), "execution/started");
        started = true;
        continue;
      }
      if (message.type === "execute/initialResponse" && message.id === executeId) {
        runtime = parseRuntimeResponse(unwrapResult(message.result, "initial execution"));
        continue;
      }
      throw new Error(`Code Mode host returned an unexpected ${String(message.type)} message.`);
    }

    const contentItems = [...runtime.contentItems];
    let hostDurationNs = runtime.hostDurationNs;
    while (runtime.kind === "Yielded") {
      const response = await operation(
        {
          method: "session/wait",
          sessionId,
          request: { cell_id: runtime.cellId, yield_time_ms: yieldTimeMs },
        },
        "wait/completed",
      );
      const outcome = objectValue(response.outcome, "wait outcome");
      const next = outcome.LiveCell ?? outcome.MissingCell;
      if (!next) throw new Error("Code Mode host returned an invalid wait outcome.");
      runtime = parseRuntimeResponse(next);
      contentItems.push(...runtime.contentItems);
      hostDurationNs += runtime.hostDurationNs;
    }

    await delegateQueue;
    const errorText =
      runtime.kind === "Terminated" ? "Code Mode execution was terminated." : runtime.errorText;
    return {
      contentItems,
      ...(errorText ? { errorText } : {}),
      hostDurationNs,
      nestedToolCalls,
      terminate,
    };
  } finally {
    options.signal.removeEventListener("abort", abortHost);
    for (const controller of delegateControllers.values()) controller.abort();
    host.stop();
  }
}
