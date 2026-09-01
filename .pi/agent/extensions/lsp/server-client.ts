import { spawn } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CancellationTokenSource,
  type ConfigurationParams,
  ConfigurationRequest,
  createProtocolConnection,
  DefinitionRequest,
  type Diagnostic,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  type DocumentDiagnosticReport,
  DocumentDiagnosticRequest,
  ExitNotification,
  type Hover,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  type Location,
  type LocationLink,
  type Position,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
  ReferencesRequest,
  ShutdownRequest,
} from "vscode-languageserver-protocol/node";
import type { ProjectFile } from "./paths";
import type { LspServerSettings, LspTimeouts } from "./settings";

const MAX_STDERR_CHARACTERS = 65_536;
const FORCE_KILL_GRACE_MS = 250;
const FORCE_KILL_WAIT_MS = 1_000;
const PUSH_SERVER_WARMUP_MS = 3_000;
const INITIAL_DIAGNOSTICS_WAIT_MS = 250;

interface OpenDocument {
  readonly languageId: string;
  readonly text: string;
  readonly version: number;
}

interface SynchronizationSettings {
  readonly change: number;
  readonly includeSaveText: boolean;
  readonly openClose: boolean;
  readonly save: boolean;
}

export interface ClientStatus {
  readonly documents: number;
  readonly error?: string;
  readonly root: string;
  readonly serverId: string;
  readonly state: "failed" | "ready" | "starting" | "stopped" | "stopping";
  readonly stderr?: string;
}

function noOpLogger() {
  return {
    error() {},
    warn() {},
    info() {},
    log() {},
  };
}

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

function cancellationError(label: string): Error {
  const error = new Error(`${label} cancelled`);
  error.name = "AbortError";
  return error;
}

function abortableDelay(ms: number, signal: AbortSignal | undefined, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(cancellationError(label));
    };
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
  });
}

function configurationValue(
  settings: Record<string, unknown> | undefined,
  section: string | undefined,
): unknown {
  if (settings === undefined) return null;
  if (section === undefined || section === "") return settings;
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !(key in value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function contentChanges(previousText: string, text: string, synchronizationKind: number) {
  if (synchronizationKind !== 2) return [{ text }];
  const lines = previousText.split("\n");
  return [
    {
      range: {
        start: { character: 0, line: 0 },
        end: { character: lines.at(-1)?.length ?? 0, line: lines.length - 1 },
      },
      text,
    },
  ];
}

export class LspServerClient {
  readonly server: LspServerSettings;
  readonly root: string;
  readonly timeouts: LspTimeouts;
  private readonly child: ReturnType<typeof spawn>;
  private readonly connection: ProtocolConnection;
  private readonly spawned: Promise<void>;
  private readonly diagnostics = new Map<string, PublishDiagnosticsParams>();
  private readonly diagnosticWaiters = new Map<
    string,
    Set<(params: PublishDiagnosticsParams) => void>
  >();
  private readonly documents = new Map<string, OpenDocument>();
  private capabilities: InitializeResult["capabilities"] | undefined;
  private error: string | undefined;
  private exited = false;
  private state: ClientStatus["state"] = "starting";
  private stderr = "";

  private constructor(server: LspServerSettings, root: string, timeouts: LspTimeouts) {
    this.server = server;
    this.root = root;
    this.timeouts = timeouts;
    this.child = spawn(server.command, server.args, {
      cwd: root,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.spawned = new Promise((resolve, reject) => {
      this.child.once("spawn", resolve);
      this.child.once("error", reject);
    });
    if (this.child.stdout === null || this.child.stdin === null) {
      throw new Error(`LSP server ${server.id} did not expose stdio`);
    }
    this.connection = createProtocolConnection(this.child.stdout, this.child.stdin, noOpLogger());
    this.connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      const version = this.documents.get(params.uri)?.version;
      if (params.version !== undefined && version !== undefined && params.version < version) return;
      this.diagnostics.set(params.uri, params);
      const waiters = this.diagnosticWaiters.get(params.uri);
      if (waiters === undefined) return;
      this.diagnosticWaiters.delete(params.uri);
      for (const waiter of waiters) waiter(params);
    });
    this.connection.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason: "Pi LSP integration is read-only",
    }));
    this.connection.onRequest("client/registerCapability", () => null);
    this.connection.onRequest("client/unregisterCapability", () => null);
    this.connection.onRequest(ConfigurationRequest.type.method, (params: ConfigurationParams) =>
      params.items.map((item) => configurationValue(server.settings, item.section)),
    );
    this.connection.onError((error) => {
      this.fail(`protocol error: ${error[0].message}`);
    });
    this.connection.onClose(() => {
      if (this.state !== "stopping" && this.state !== "stopped") {
        this.fail("protocol connection closed");
      }
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_STDERR_CHARACTERS);
    });
    this.child.on("error", (cause) => {
      if (this.child.pid === undefined) this.exited = true;
      this.fail(`spawn failed: ${cause.message}`);
    });
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      if (this.state === "stopping" || this.state === "stopped") return;
      this.fail(
        `server exited (${code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`})`,
      );
    });
    this.child.on("close", () => {
      this.exited = true;
    });
    this.connection.listen();
  }

  static async start(
    server: LspServerSettings,
    root: string,
    timeouts: LspTimeouts,
    signal?: AbortSignal,
  ): Promise<LspServerClient> {
    const client = new LspServerClient(server, root, timeouts);
    try {
      await client.spawned;
      const result = await client.request<InitializeResult>(
        InitializeRequest.type,
        {
          processId: process.pid,
          clientInfo: { name: "pi-lsp", version: "1" },
          rootPath: root,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            textDocument: {
              definition: { dynamicRegistration: false, linkSupport: true },
              diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
              hover: {
                contentFormat: ["markdown", "plaintext"],
                dynamicRegistration: false,
              },
              publishDiagnostics: { relatedInformation: true, versionSupport: true },
              references: { dynamicRegistration: false },
              synchronization: { didSave: true, dynamicRegistration: false },
            },
            workspace: {
              applyEdit: false,
              configuration: true,
              workspaceFolders: false,
            },
          },
          initializationOptions: server.initializationOptions,
          workspaceFolders: [{ name: basename(root), uri: pathToFileURL(root).href }],
        },
        timeouts.startupMs,
        signal,
        "LSP initialize",
      );
      const encoding = result.capabilities.positionEncoding ?? "utf-16";
      if (encoding !== "utf-16") throw new Error(`unsupported position encoding: ${encoding}`);
      client.capabilities = result.capabilities;
      client.connection.sendNotification(InitializedNotification.type, {});
      if (server.settings !== undefined) {
        client.connection.sendNotification(DidChangeConfigurationNotification.type, {
          settings: server.settings,
        });
      }
      client.state = "ready";
      return client;
    } catch (cause) {
      client.fail(cause instanceof Error ? cause.message : String(cause));
      const failure = new Error(client.error ?? String(cause));
      failure.name = cause instanceof Error ? cause.name : "Error";
      await client.stopProcess().catch(() => undefined);
      throw failure;
    }
  }

  status(): ClientStatus {
    return {
      documents: this.documents.size,
      root: this.root,
      serverId: this.server.id,
      state: this.state,
      ...(this.error === undefined ? {} : { error: this.error }),
      ...(this.stderr.trim() === "" ? {} : { stderr: this.stderr.trim() }),
    };
  }

  supports(operation: "hover" | "goto_definition" | "find_references"): boolean {
    if (operation === "hover") return Boolean(this.capabilities?.hoverProvider);
    if (operation === "goto_definition") return Boolean(this.capabilities?.definitionProvider);
    return Boolean(this.capabilities?.referencesProvider);
  }

  async synchronize(document: ProjectFile): Promise<void> {
    this.assertReady();
    const uri = pathToFileURL(document.canonicalPath).href;
    const open = this.documents.get(uri);
    const synchronization = this.synchronizationSettings();
    if (open === undefined) {
      this.diagnostics.delete(uri);
      if (synchronization.openClose) {
        this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: {
            languageId: document.languageId,
            text: document.text,
            uri,
            version: 1,
          },
        });
      }
      this.documents.set(uri, { languageId: document.languageId, text: document.text, version: 1 });
    } else if (open.text !== document.text) {
      const version = open.version + 1;
      this.diagnostics.delete(uri);
      this.documents.set(uri, { ...open, text: document.text, version });
      if (synchronization.change !== 0) {
        this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
          contentChanges: contentChanges(open.text, document.text, synchronization.change),
          textDocument: { uri, version },
        });
      }
    }
    if (synchronization.save) {
      this.connection.sendNotification(DidSaveTextDocumentNotification.type, {
        ...(synchronization.includeSaveText ? { text: document.text } : {}),
        textDocument: { uri },
      });
    }
  }

  async freshDiagnostics(
    document: ProjectFile,
    signal: AbortSignal | undefined,
  ): Promise<readonly Diagnostic[]> {
    const uri = pathToFileURL(document.canonicalPath).href;
    if (this.capabilities?.diagnosticProvider) {
      await this.synchronize(document);
      const report = await this.request<DocumentDiagnosticReport>(
        DocumentDiagnosticRequest.type,
        { textDocument: { uri } },
        this.timeouts.diagnosticsMs,
        signal,
        "LSP diagnostics",
      );
      if (report.kind === "full") {
        this.diagnostics.set(uri, { diagnostics: report.items, uri });
        return report.items;
      }
      return this.diagnostics.get(uri)?.diagnostics ?? [];
    }
    const wasOpen = this.documents.has(uri);
    const timeoutMs = wasOpen
      ? this.timeouts.diagnosticsMs
      : PUSH_SERVER_WARMUP_MS + this.timeouts.diagnosticsMs;
    const next = this.waitForDiagnostics(uri, signal, timeoutMs);
    let pulsed = false;
    try {
      await this.synchronize(document);
    } catch (cause) {
      void next.catch(() => undefined);
      throw cause;
    }
    try {
      if (wasOpen === false) {
        const initial = await Promise.race([
          next,
          new Promise<undefined>((resolve) => setTimeout(resolve, INITIAL_DIAGNOSTICS_WAIT_MS)),
        ]);
        if (initial !== undefined) return initial.diagnostics;
        // Push-only servers such as Lua LS may need a warmed-up document change first.
        await abortableDelay(
          PUSH_SERVER_WARMUP_MS - INITIAL_DIAGNOSTICS_WAIT_MS,
          signal,
          "LSP diagnostics",
        );
        pulsed = this.pulseDocument(document);
        if (pulsed) {
          await next;
          const restored = this.waitForDiagnostics(uri, signal);
          try {
            await this.synchronize(document);
          } catch (cause) {
            void restored.catch(() => undefined);
            throw cause;
          }
          pulsed = false;
          return (await restored).diagnostics;
        }
      }
      return (await next).diagnostics;
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw cause;
    } finally {
      if (pulsed) await this.synchronize(document);
    }
  }

  async hover(document: ProjectFile, position: Position, signal: AbortSignal | undefined) {
    await this.synchronize(document);
    return this.request<Hover | null>(
      HoverRequest.type,
      { position, textDocument: { uri: pathToFileURL(document.canonicalPath).href } },
      this.timeouts.requestMs,
      signal,
      "LSP hover",
    );
  }

  async definition(document: ProjectFile, position: Position, signal: AbortSignal | undefined) {
    await this.synchronize(document);
    return this.request<Location | Location[] | LocationLink[] | null>(
      DefinitionRequest.type,
      { position, textDocument: { uri: pathToFileURL(document.canonicalPath).href } },
      this.timeouts.requestMs,
      signal,
      "LSP definition",
    );
  }

  async references(
    document: ProjectFile,
    position: Position,
    includeDeclaration: boolean,
    signal: AbortSignal | undefined,
  ) {
    await this.synchronize(document);
    return this.request<Location[] | null>(
      ReferencesRequest.type,
      {
        context: { includeDeclaration },
        position,
        textDocument: { uri: pathToFileURL(document.canonicalPath).href },
      },
      this.timeouts.requestMs,
      signal,
      "LSP references",
    );
  }

  async shutdown(): Promise<void> {
    if (this.state === "stopped" || this.state === "stopping") return;
    this.state = "stopping";
    try {
      if (this.synchronizationSettings().openClose) {
        await Promise.all(
          [...this.documents.keys()].map((uri) =>
            this.connection.sendNotification(DidCloseTextDocumentNotification.type, {
              textDocument: { uri },
            }),
          ),
        );
      }
      await this.request<void>(
        ShutdownRequest.type,
        undefined,
        this.timeouts.shutdownMs,
        undefined,
        "LSP shutdown",
        true,
      );
      await this.connection.sendNotification(ExitNotification.type);
    } catch {
      // Forced process-tree termination below is the shutdown fallback.
    }
    try {
      await this.stopProcess();
    } finally {
      this.connection.dispose();
    }
    this.state = "stopped";
    this.documents.clear();
    this.diagnostics.clear();
  }

  private assertReady(): void {
    if (this.state !== "ready") throw new Error(this.error ?? `LSP server is ${this.state}`);
  }

  private fail(message: string): void {
    if (this.state === "stopping" || this.state === "stopped") return;
    this.error ??= message;
    this.state = "failed";
  }

  private async request<R>(
    type: { readonly method: string },
    params: unknown,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    label: string,
    allowStopping = false,
  ): Promise<R> {
    if (allowStopping === false) this.assertReadyOrStarting();
    if (signal?.aborted) throw cancellationError(label);
    const cancellation = new CancellationTokenSource();
    let rejectAbort: ((cause: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const cancel = () => {
      cancellation.cancel();
      rejectAbort?.(cancellationError(label));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        cancellation.cancel();
        reject(timeoutError(label, timeoutMs));
      }, timeoutMs);
    });
    try {
      return (await Promise.race([
        this.connection.sendRequest(type.method, params, cancellation.token),
        timeout,
        aborted,
      ])) as R;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      cancellation.dispose();
    }
  }

  private assertReadyOrStarting(): void {
    if (this.state !== "ready" && this.state !== "starting") {
      throw new Error(this.error ?? `LSP server is ${this.state}`);
    }
  }

  private synchronizationSettings(): SynchronizationSettings {
    const synchronization = this.capabilities?.textDocumentSync;
    if (typeof synchronization === "number") {
      return {
        change: synchronization,
        includeSaveText: false,
        openClose: synchronization !== 0,
        save: false,
      };
    }
    const save = synchronization?.save;
    return {
      change: synchronization?.change ?? 0,
      includeSaveText: typeof save === "object" && save.includeText === true,
      openClose: synchronization?.openClose === true,
      save: save === true || typeof save === "object",
    };
  }

  private waitForDiagnostics(
    uri: string,
    signal: AbortSignal | undefined,
    timeoutMs = this.timeouts.diagnosticsMs,
  ): Promise<PublishDiagnosticsParams> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiters = this.diagnosticWaiters.get(uri) ?? new Set();
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        waiters.delete(complete);
        if (waiters.size === 0) this.diagnosticWaiters.delete(uri);
      };
      const complete = (params: PublishDiagnosticsParams) => {
        cleanup();
        resolve(params);
      };
      const cancel = () => {
        cleanup();
        reject(new Error("LSP diagnostics cancelled"));
      };
      waiters.add(complete);
      this.diagnosticWaiters.set(uri, waiters);
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        cleanup();
        reject(timeoutError("LSP diagnostics", timeoutMs));
      }, timeoutMs);
      if (signal?.aborted) cancel();
    });
  }

  private pulseDocument(document: ProjectFile): boolean {
    const uri = pathToFileURL(document.canonicalPath).href;
    const open = this.documents.get(uri);
    const synchronization = this.synchronizationSettings();
    if (open === undefined || synchronization.change === 0) return false;
    const text = document.text.endsWith(" ") ? document.text.slice(0, -1) : `${document.text} `;
    const version = open.version + 1;
    this.diagnostics.delete(uri);
    this.documents.set(uri, { ...open, text, version });
    this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
      contentChanges: contentChanges(open.text, text, synchronization.change),
      textDocument: { uri, version },
    });
    if (synchronization.save) {
      this.connection.sendNotification(DidSaveTextDocumentNotification.type, {
        ...(synchronization.includeSaveText ? { text } : {}),
        textDocument: { uri },
      });
    }
    return true;
  }

  private async stopProcess(): Promise<void> {
    if (this.exited) return;
    if (await this.waitForExit(FORCE_KILL_GRACE_MS)) return;
    this.signalProcessTree("SIGTERM");
    if (await this.waitForExit(FORCE_KILL_GRACE_MS)) return;
    this.signalProcessTree("SIGKILL");
    if (await this.waitForExit(FORCE_KILL_WAIT_MS)) return;
    throw new Error(`LSP server ${this.server.id} did not exit after SIGKILL`);
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const exited = () => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(true);
      };
      this.child.once("exit", exited);
      timer = setTimeout(() => {
        this.child.removeListener("exit", exited);
        resolve(this.exited);
      }, timeoutMs);
    });
  }

  private signalProcessTree(signal: NodeJS.Signals): void {
    if (process.platform === "win32" || this.child.pid === undefined) {
      this.child.kill(signal);
      return;
    }
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      // The process group has already exited.
    }
  }
}
