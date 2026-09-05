import { createConnection, type Socket } from "node:net";
import { isAbsolute, resolve } from "node:path";
import type { Logger } from "neovim/lib/utils/logger";
import {
  type ActiveContext,
  type AnnotationOptions,
  type AnnotationSnapshot,
  type BridgeResult,
  type BufferInventory,
  type BufferRead,
  type BufferReadOptions,
  canonicalPath,
  DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS,
  DEFAULT_QUICKFIX_ITEMS,
  type DiagnosticSummary,
  type DiagnosticSummaryOptions,
  type DiagnosticsSnapshot,
  type EditorIdentity,
  type FocusContext,
  type HighlightClearOptions,
  type HighlightClearSnapshot,
  type HighlightOptions,
  type HighlightSnapshot,
  invalidQuickfixWindow,
  MAX_METADATA_STRING_BYTES,
  MAX_QUICKFIX_ITEMS,
  type NeovimError,
  noFocusContext,
  noSelection,
  parseActiveContext,
  parseAnnotations,
  parseBufferInventory,
  parseBufferRead,
  parseDiagnosticSummary,
  parseDiagnostics,
  parseFocusNotification,
  parseHighlight,
  parseHighlightClear,
  parseQuickfix,
  parseReveal,
  parseVisibleWindows,
  type QuickfixOptions,
  type QuickfixSnapshot,
  quickfixRequestLimit,
  type RevealOptions,
  type RevealSnapshot,
  resolveAnnotationOptions,
  resolveHighlightClearOptions,
  resolveHighlightOptions,
  resolveRevealOptions,
  type SelectionSnapshot,
  unavailable,
  type VisibleWindowsSnapshot,
  worktreesMatch,
} from "./contracts";
import { NeovimEffectScope, runWithTimeout } from "./effect-runtime";
import {
  type PromptAcknowledgement,
  type PromptBinding,
  type PromptFailureCode,
  type PromptRequest,
  type PromptRequestIdentity,
  parsePromptBinding,
  parsePromptNotification,
  type SelectionReference,
} from "./prompt-protocol";

const CONNECT_TIMEOUT_MS = 1_000;
const RPC_TIMEOUT_MS = 2_000;

class NeovimConnectionError extends Error {
  constructor(readonly bridgeError: NeovimError) {
    super(bridgeError.message);
  }
}

const BRIDGE_DISPATCH_LUA = `
return require("plugins.ai.pi.bridge").dispatch(...)
`;

export const bridgeOperations = {
  activeContext: "active_context",
  annotate: "annotate",
  bindSession: "bind_session",
  clearHighlight: "clear_highlight",
  deleteAnnotations: "delete_annotations",
  deleteHighlight: "delete_highlight",
  diagnostics: "diagnostics",
  diagnosticSummary: "diagnostic_summary",
  highlight: "highlight",
  installNotifications: "install_notifications",
  listBuffers: "list_buffers",
  promptAck: "prompt_ack",
  quickfix: "quickfix",
  readBuffer: "read_buffer",
  removeNotifications: "remove_notifications",
  reveal: "reveal",
  visibleWindows: "visible_windows",
} as const;

type BridgeOperation = (typeof bridgeOperations)[keyof typeof bridgeOperations];

export const bridgeLua = { dispatch: BRIDGE_DISPATCH_LUA } as const;

export interface NvimConnection {
  readonly channelId: Promise<number>;
  close(): Promise<void>;
  executeLua(code: string, args?: unknown[]): Promise<unknown>;
  off(event: "disconnect" | "notification", listener: (...args: unknown[]) => void): this;
  on(event: "disconnect" | "notification", listener: (...args: unknown[]) => void): this;
  setClientInfo(
    name: string,
    version: object,
    type: string,
    methods: object,
    attributes: object,
  ): void;
}

export type NvimConnectionFactory = (socketPath: string) => Promise<NvimConnection>;
export type PromptRequestHandler = (request: PromptRequest) => PromptAcknowledgement;
export type MalformedPromptHandler = (
  request: PromptRequestIdentity,
  code: PromptFailureCode,
  fingerprint?: string,
) => PromptAcknowledgement;

async function executeBridge(
  connection: NvimConnection,
  operation: BridgeOperation,
  payload: Readonly<object> = {},
): Promise<unknown> {
  const channelId = await connection.channelId;
  return connection.executeLua(BRIDGE_DISPATCH_LUA, [{ channelId, operation, payload }]);
}

const silentLogger = {
  debug() {},
  error() {},
  info() {},
  level: "error",
  warn() {},
} as unknown as Logger;

function waitForSocket(socket: Socket): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out connecting to the inherited Neovim socket"));
    }, CONNECT_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", connected);
      socket.off("error", failed);
    };
    const connected = () => {
      cleanup();
      resolvePromise();
    };
    const failed = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    socket.once("connect", connected);
    socket.once("error", failed);
  });
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return runWithTimeout(promise, message, RPC_TIMEOUT_MS);
}

function annotationMayHaveMutated(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  const error = (value as Record<string, unknown>).error;
  return typeof error !== "string" || error === "extmarkFailure";
}

function highlightCleanupId(value: unknown, expectedBuffer: number): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.buffer !== "object" ||
    snapshot.buffer === null ||
    Array.isArray(snapshot.buffer)
  ) {
    return undefined;
  }
  const buffer = snapshot.buffer as Record<string, unknown>;
  return buffer.number === expectedBuffer &&
    Number.isSafeInteger(snapshot.highlightId) &&
    (snapshot.highlightId as number) > 0
    ? (snapshot.highlightId as number)
    : undefined;
}

async function defaultConnectionFactory(socketPath: string): Promise<NvimConnection> {
  const socket = createConnection(socketPath);
  // Keep connection failures from becoming process-level uncaught errors.
  socket.on("error", () => undefined);
  await waitForSocket(socket);
  const { attach } = await import("neovim");
  // Avoid neovim@5's default Winston logger: Pi's runtime cannot resolve its lazy
  // CJS transport tree reliably, and the logger also monkey-patches global console.
  return attach({ options: { logger: silentLogger }, reader: socket, writer: socket });
}

export class PiNeovimChannel {
  readonly #cwd: string;
  readonly #createConnection: NvimConnectionFactory;
  readonly #effectScope = new NeovimEffectScope();
  readonly #socketPath: string | undefined;
  #connectionPromise: Promise<NvimConnection> | undefined;
  #connection: NvimConnection | undefined;
  #editor: EditorIdentity | undefined;
  #focusContext: FocusContext | undefined;
  #nextAnnotationBatchId = 1;
  readonly #presentationOperations = new Set<Promise<void>>();
  #promptBinding: PromptBinding | undefined;
  #promptReference: SelectionReference | undefined;
  readonly #promptOperations = new Set<Promise<void>>();
  #promptRejectionHandler: MalformedPromptHandler | undefined;
  #promptRequestHandler: PromptRequestHandler | undefined;
  #unavailableError: NeovimError | undefined;

  constructor(
    socketPath: string | undefined,
    cwd: string,
    createConnection: NvimConnectionFactory = defaultConnectionFactory,
  ) {
    this.#socketPath = socketPath;
    this.#cwd = cwd;
    this.#createConnection = createConnection;
  }

  async status(): Promise<BridgeResult<EditorIdentity>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    return { ok: true, value: this.#editor };
  }

  async bindSession(
    sessionId: string,
    launchId?: string,
    replacePending = false,
  ): Promise<BridgeResult<EditorIdentity>> {
    if (
      /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionId) === false ||
      Buffer.byteLength(sessionId, "utf8") > 128 ||
      (launchId !== undefined && /^[a-f0-9]{32}$/.test(launchId) === false)
    ) {
      return {
        error: { code: "NVIM_INVALID_RESPONSE", message: "Pi returned invalid session identity" },
        ok: false,
      };
    }
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    const editor = this.#editor;
    if (editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const bound = await withTimeout(
        executeBridge(connection.value, bridgeOperations.bindSession, {
          ...(launchId === undefined ? {} : { launchId, replacePending }),
          sessionId,
        }),
        "Timed out binding Pi's session identity to Neovim",
      );
      if (launchId === undefined && bound === true) {
        this.#promptBinding = undefined;
        this.#promptReference = undefined;
        return { ok: true, value: editor };
      }
      const channelId = await connection.value.channelId;
      const promptBinding =
        launchId === undefined
          ? undefined
          : parsePromptBinding(bound, {
              channelId,
              cwd: this.#cwd,
              editorPid: editor.pid,
              launchId,
              sessionId,
            });
      if (promptBinding !== undefined) {
        this.#promptBinding = promptBinding;
        this.#promptReference = undefined;
        return { ok: true, value: editor };
      }
      return {
        error: {
          code: "NVIM_INVALID_RESPONSE",
          message: "Neovim did not accept Pi's session identity",
        },
        ok: false,
      };
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  promptBinding(): PromptBinding | undefined {
    return this.#promptBinding;
  }

  setPromptRequestHandler(
    handler: PromptRequestHandler,
    rejectMalformed?: MalformedPromptHandler,
  ): void {
    this.#promptRequestHandler = handler;
    this.#promptRejectionHandler = rejectMalformed;
  }

  async context(): Promise<BridgeResult<ActiveContext>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.activeContext),
        "Timed out reading context from the bound Neovim instance",
      );
      return snapshot === null || snapshot === undefined
        ? noFocusContext()
        : parseActiveContext(snapshot, this.#cwd);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async visibleWindows(): Promise<BridgeResult<VisibleWindowsSnapshot>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.visibleWindows),
        "Timed out reading visible windows from the bound Neovim instance",
      );
      return parseVisibleWindows(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async listBuffers(): Promise<BridgeResult<BufferInventory>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.listBuffers),
        "Timed out reading buffers from the bound Neovim instance",
      );
      return parseBufferInventory(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async readBuffer(options: BufferReadOptions): Promise<BridgeResult<BufferRead>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    const reference =
      options.path === undefined ? undefined : this.matchingPromptReference(options.path);
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.readBuffer, {
          ...(reference === undefined
            ? options.path === undefined
              ? { buffer: options.buffer }
              : { path: options.path }
            : { buffer: reference.buffer }),
          ...(options.startLine === undefined ? {} : { startLine: options.startLine }),
          ...(options.endLine === undefined ? {} : { endLine: options.endLine }),
          ...(options.expectedPath === undefined
            ? reference === undefined
              ? {}
              : { expectedPath: reference.path }
            : { expectedPath: options.expectedPath }),
          ...(options.expectedChangedtick === undefined
            ? reference === undefined
              ? {}
              : { expectedChangedtick: reference.changedtick }
            : { expectedChangedtick: options.expectedChangedtick }),
        }),
        "Timed out reading a buffer from the bound Neovim instance",
      );
      return parseBufferRead(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async diagnosticSummary(
    options: DiagnosticSummaryOptions = {},
  ): Promise<BridgeResult<DiagnosticSummary>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    const maxItems = options.maxItems ?? DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS;
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.diagnosticSummary, {
          maxItems,
          ...(options.buffer === undefined ? {} : { buffer: options.buffer }),
        }),
        "Timed out reading diagnostic summary from the bound Neovim instance",
      );
      return parseDiagnosticSummary(snapshot, this.#cwd, this.#editor, maxItems);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async diagnostics(buffer?: number): Promise<BridgeResult<DiagnosticsSnapshot>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.diagnostics, {
          ...(buffer === undefined ? {} : { buffer }),
        }),
        "Timed out reading diagnostics from the bound Neovim instance",
      );
      return parseDiagnostics(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async quickfix(options: QuickfixOptions = {}): Promise<BridgeResult<QuickfixSnapshot>> {
    const maxItems = options.maxItems ?? DEFAULT_QUICKFIX_ITEMS;
    if (Number.isSafeInteger(maxItems) === false || maxItems < 1 || maxItems > MAX_QUICKFIX_ITEMS) {
      return quickfixRequestLimit();
    }
    if (
      options.kind === "location" &&
      (Number.isSafeInteger(options.window) === false || options.window < 1)
    ) {
      return invalidQuickfixWindow();
    }
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    const kind = options.kind ?? "quickfix";
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.quickfix, {
          kind,
          maxItems,
          ...(options.kind === "location" ? { window: options.window } : {}),
        }),
        "Timed out reading a problem list from the bound Neovim instance",
      );
      return parseQuickfix(snapshot, this.#cwd, this.#editor, options);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async annotate(options: AnnotationOptions): Promise<BridgeResult<AnnotationSnapshot>> {
    const resolved = resolveAnnotationOptions(options);
    if (resolved.ok === false) return resolved;
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    const editor = this.#editor;
    if (editor === undefined) return unavailable("Neovim connection identity is unavailable");
    return this.trackPresentationOperation(
      (async () => {
        try {
          const batchId = this.#nextAnnotationBatchId;
          this.#nextAnnotationBatchId =
            batchId === Number.MAX_SAFE_INTEGER ? 1 : this.#nextAnnotationBatchId + 1;
          const cleanup = () =>
            withTimeout(
              executeBridge(connection.value, bridgeOperations.deleteAnnotations, {
                batchId,
                buffer: resolved.value.buffer,
              }),
              "Timed out rolling back an annotation batch",
            ).catch(() => undefined);
          const snapshot = await withTimeout(
            executeBridge(connection.value, bridgeOperations.annotate, {
              annotations: resolved.value.annotations,
              batchId,
              buffer: resolved.value.buffer,
              durationMs: resolved.value.durationMs,
              expectedCwd: this.#cwd,
            }),
            "Timed out creating annotations in the bound Neovim instance",
          ).catch(async (error: unknown) => {
            await cleanup();
            throw error;
          });
          const result = parseAnnotations(snapshot, this.#cwd, editor, options, batchId);
          if (result.ok === false && annotationMayHaveMutated(snapshot)) await cleanup();
          return result;
        } catch {
          return this.markUnavailable("The bound Neovim instance stopped responding");
        }
      })(),
    );
  }

  async highlight(options: HighlightOptions): Promise<BridgeResult<HighlightSnapshot>> {
    const resolved = resolveHighlightOptions(options);
    if (resolved.ok === false) return resolved;
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    const editor = this.#editor;
    if (editor === undefined) return unavailable("Neovim connection identity is unavailable");
    return this.trackPresentationOperation(
      (async () => {
        try {
          const snapshot = await withTimeout(
            executeBridge(connection.value, bridgeOperations.highlight, {
              buffer: resolved.value.buffer,
              durationMs: resolved.value.durationMs,
              ...(resolved.value.endColumn === undefined
                ? {}
                : { endColumn: resolved.value.endColumn }),
              endLine: resolved.value.endLine,
              expectedCwd: this.#cwd,
              startColumn: resolved.value.startColumn,
              startLine: resolved.value.startLine,
            }),
            "Timed out creating a temporary highlight in the bound Neovim instance",
          );
          const result = parseHighlight(snapshot, this.#cwd, editor, options);
          if (result.ok === false) {
            const highlightId = highlightCleanupId(snapshot, resolved.value.buffer);
            if (highlightId !== undefined) {
              await withTimeout(
                executeBridge(connection.value, bridgeOperations.deleteHighlight, {
                  buffer: resolved.value.buffer,
                  highlightId,
                }),
                "Timed out rolling back an invalid highlight response",
              ).catch(() => undefined);
            }
          }
          return result;
        } catch {
          return this.markUnavailable("The bound Neovim instance stopped responding");
        }
      })(),
    );
  }

  async clearHighlight(
    options: HighlightClearOptions,
  ): Promise<BridgeResult<HighlightClearSnapshot>> {
    const resolved = resolveHighlightClearOptions(options);
    if (resolved.ok === false) return resolved;
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    const editor = this.#editor;
    if (editor === undefined) return unavailable("Neovim connection identity is unavailable");
    return this.trackPresentationOperation(
      (async () => {
        try {
          const snapshot = await withTimeout(
            executeBridge(connection.value, bridgeOperations.clearHighlight, {
              buffer: resolved.value.buffer,
              expectedCwd: this.#cwd,
              highlightId: resolved.value.highlightId,
            }),
            "Timed out removing a temporary highlight from the bound Neovim instance",
          );
          return parseHighlightClear(snapshot, this.#cwd, editor, resolved.value);
        } catch {
          return this.markUnavailable("The bound Neovim instance stopped responding");
        }
      })(),
    );
  }

  async reveal(options: RevealOptions): Promise<BridgeResult<RevealSnapshot>> {
    const resolved = resolveRevealOptions(options);
    if (resolved.ok === false) return resolved;
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        executeBridge(connection.value, bridgeOperations.reveal, {
          buffer: resolved.value.buffer,
          column: resolved.value.column,
          expectedCwd: this.#cwd,
          focus: resolved.value.focus,
          line: resolved.value.line,
          split: resolved.value.split,
        }),
        "Timed out revealing a source location in the bound Neovim instance",
      );
      const result = parseReveal(snapshot, this.#cwd, this.#editor, resolved.value);
      if (result.ok && resolved.value.focus) {
        this.#focusContext = {
          buffer: result.value.buffer,
          cursor: result.value.position,
          cwd: result.value.editor.cwd,
          pid: result.value.editor.pid,
        };
      }
      return result;
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async focusContext(): Promise<BridgeResult<FocusContext>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    return this.#focusContext === undefined
      ? noFocusContext()
      : { ok: true, value: this.#focusContext };
  }

  async selection(): Promise<BridgeResult<SelectionSnapshot>> {
    const context = await this.context();
    if (context.ok === false) return context;
    if (context.value.selection === undefined) return noSelection();
    return {
      ok: true,
      value: {
        ...context.value.selection,
        buffer: context.value.buffer,
        cwd: context.value.cwd,
        pid: context.value.pid,
      },
    };
  }

  async close(): Promise<void> {
    this.#unavailableError = {
      code: "NVIM_UNAVAILABLE",
      message: "The Neovim channel is closed",
    };
    this.#focusContext = undefined;
    this.#promptBinding = undefined;
    this.#promptReference = undefined;
    this.#promptRejectionHandler = undefined;
    this.#promptRequestHandler = undefined;
    await this.#connectionPromise?.catch(() => undefined);
    await Promise.all([...this.#presentationOperations, ...this.#promptOperations]);
    this.#connection = undefined;
    this.#connectionPromise = undefined;
    this.#editor = undefined;
    await this.#effectScope.close();
  }

  private async trackPresentationOperation<T>(operation: Promise<T>): Promise<T> {
    const completion = operation.then(
      () => undefined,
      () => undefined,
    );
    this.#presentationOperations.add(completion);
    try {
      return await operation;
    } finally {
      this.#presentationOperations.delete(completion);
    }
  }

  private readonly handleNotification = (method: unknown, args: unknown): void => {
    if (typeof method !== "string") return;
    const focus = parseFocusNotification(method, args, this.#cwd);
    if (focus !== undefined) {
      if (focus.ok) this.#focusContext = focus.value;
      return;
    }

    const prompt = parsePromptNotification(method, args, this.#cwd);
    if (prompt === undefined) return;
    const acknowledgement = prompt.ok
      ? this.#promptRequestHandler?.(prompt.value)
      : prompt.identity === undefined
        ? undefined
        : this.#promptRejectionHandler?.(prompt.identity, prompt.error, prompt.fingerprint);
    if (prompt.ok && acknowledgement?.outcome === "accepted") {
      this.#promptReference = prompt.value.context ?? undefined;
    }
    const connection = this.#connection;
    if (acknowledgement === undefined || connection === undefined) return;
    const operation = withTimeout(
      executeBridge(connection, bridgeOperations.promptAck, acknowledgement),
      "Timed out acknowledging Neovim's prompt request",
    ).then(
      () => undefined,
      () => {
        this.markUnavailable("The bound Neovim instance stopped responding");
      },
    );
    this.#promptOperations.add(operation);
    void operation.finally(() => this.#promptOperations.delete(operation));
  };

  private readonly handleDisconnect = (): void => {
    this.#promptBinding = undefined;
    this.#promptReference = undefined;
    this.markUnavailable("The bound Neovim instance disconnected");
  };

  private async connection(): Promise<BridgeResult<NvimConnection>> {
    if (this.#unavailableError !== undefined) {
      return { error: this.#unavailableError, ok: false };
    }
    if (this.#connection !== undefined) return { ok: true, value: this.#connection };
    if (this.#socketPath === undefined || this.#socketPath === "") return unavailable();
    if (this.#connectionPromise === undefined) {
      this.#connectionPromise = this.#connect();
    }
    try {
      const connection = await this.#connectionPromise;
      return this.#unavailableError === undefined
        ? { ok: true, value: connection }
        : { error: this.#unavailableError, ok: false };
    } catch (error) {
      return error instanceof NeovimConnectionError
        ? this.markError(error.bridgeError)
        : this.markUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async #connect(): Promise<NvimConnection> {
    return this.#effectScope.acquire(
      () => this.#openConnection(),
      (connection) => this.#releaseConnection(connection),
    );
  }

  async #openConnection(): Promise<NvimConnection> {
    const socketPath = this.#socketPath;
    if (socketPath === undefined || socketPath === "") {
      throw new Error("No bound Neovim instance is available");
    }
    const connection = await this.#createConnection(socketPath);
    connection.on("notification", this.handleNotification);
    connection.on("disconnect", this.handleDisconnect);
    try {
      const channelId = await withTimeout(
        connection.channelId,
        "Timed out initializing the bound Neovim instance",
      );
      connection.setClientInfo("pi-neovim", { major: 0, minor: 1 }, "remote", {}, {});
      const identity = parseEditorIdentity(
        await withTimeout(
          executeBridge(connection, bridgeOperations.installNotifications),
          "Timed out configuring the bound Neovim instance",
        ),
        this.#cwd,
        channelId,
      );
      if (identity.ok === false) throw new NeovimConnectionError(identity.error);
      this.#connection = connection;
      this.#editor = identity.value;
      return connection;
    } catch (error) {
      connection.off("notification", this.handleNotification);
      connection.off("disconnect", this.handleDisconnect);
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  async #releaseConnection(connection: NvimConnection): Promise<void> {
    connection.off("notification", this.handleNotification);
    connection.off("disconnect", this.handleDisconnect);
    try {
      await withTimeout(
        executeBridge(connection, bridgeOperations.removeNotifications),
        "Timed out cleaning up the bound Neovim instance",
      );
    } catch {
      // The editor may already be gone; closing the transport is still required.
    }
    await connection.close().catch(() => undefined);
  }

  private matchingPromptReference(path: string): SelectionReference | undefined {
    const reference = this.#promptReference;
    if (reference === undefined) return undefined;
    const canonical = canonicalPath(isAbsolute(path) ? path : resolve(this.#cwd, path));
    return canonical === reference.path ? reference : undefined;
  }

  private markError(error: NeovimError): BridgeResult<never> {
    this.#unavailableError = error;
    this.#promptReference = undefined;
    return { error, ok: false };
  }

  private markUnavailable(message: string): BridgeResult<never> {
    return this.markError({ code: "NVIM_UNAVAILABLE", message });
  }
}

function parseEditorIdentity(
  value: unknown,
  expectedCwd: string,
  expectedChannelId: number,
): BridgeResult<EditorIdentity> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Number.isInteger((value as Record<string, unknown>).pid) === false ||
    Number.isInteger((value as Record<string, unknown>).channelId) === false ||
    typeof (value as Record<string, unknown>).cwd !== "string" ||
    Buffer.byteLength((value as Record<string, unknown>).cwd as string, "utf8") >
      MAX_METADATA_STRING_BYTES
  ) {
    return {
      error: {
        code: "NVIM_INVALID_RESPONSE",
        message: "Neovim returned invalid connection identity",
      },
      ok: false,
    };
  }
  const record = value as { channelId: number; cwd: string; pid: number };
  if (record.channelId !== expectedChannelId) {
    return {
      error: {
        code: "NVIM_INVALID_RESPONSE",
        message: "Neovim returned an unexpected channel identity",
      },
      ok: false,
    };
  }
  if (worktreesMatch(record.cwd, expectedCwd) === false) {
    return {
      error: {
        code: "NVIM_WORKTREE_MISMATCH",
        message: "The bound Neovim instance does not match Pi's working directory",
      },
      ok: false,
    };
  }
  return { ok: true, value: record };
}
