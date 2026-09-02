import { basename, extname, resolve } from "node:path";
import type { Location, LocationLink } from "vscode-languageserver-protocol/node";
import {
  renderDiagnostics,
  renderHovers,
  renderLocations,
  type ServerDiagnostic,
  type ServerHover,
  type ServerLocations,
} from "./output";
import {
  canonicalProjectRoot,
  findServerRoot,
  languageForPath,
  type ProjectFile,
  readProjectFile,
} from "./paths";
import { toProtocolPosition } from "./positions";
import { type ClientStatus, LspServerClient } from "./server-client";
import type { LspServerSettings, ResolvedLspSettings } from "./settings";

const MAX_INSTANCES = 16;

interface InstanceRecord {
  client?: LspServerClient;
  error?: string;
  readonly promise: Promise<LspServerClient>;
  readonly root: string;
  readonly server: LspServerSettings;
}

interface Match {
  readonly client: LspServerClient;
  readonly document: ProjectFile;
  readonly server: LspServerSettings;
}

interface MatchResult {
  readonly matches: readonly Match[];
  readonly warnings: readonly string[];
}

export interface LspOperationResult {
  readonly diagnosticCount?: number;
  readonly matched: boolean;
  readonly text: string;
  readonly warnings: readonly string[];
}

function normalizedDefinition(
  result: Location | Location[] | LocationLink[] | null,
): readonly (Location | LocationLink)[] {
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

function appendOperationWarning(
  warnings: string[],
  serverId: string,
  cause: unknown,
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) throw cause;
  warnings.push(`${serverId}: ${cause instanceof Error ? cause.message : String(cause)}`);
}

export class LspServerManager {
  readonly projectRoot: string;
  readonly settings: ResolvedLspSettings;
  private readonly instances = new Map<string, InstanceRecord>();
  private shuttingDown = false;

  private constructor(projectRoot: string, settings: ResolvedLspSettings) {
    this.projectRoot = projectRoot;
    this.settings = settings;
  }

  static async create(cwd: string, settings: ResolvedLspSettings): Promise<LspServerManager> {
    return new LspServerManager(await canonicalProjectRoot(cwd), settings);
  }

  status(): string {
    const configured = this.settings.servers.map((server) =>
      `${server.id}: configured (${server.command} ${server.args.join(" ")})`.trim(),
    );
    const active = [...this.instances.values()].map((record) => {
      const status: ClientStatus = record.client?.status() ?? {
        documents: 0,
        root: record.root,
        serverId: record.server.id,
        state: record.error === undefined ? "starting" : "failed",
        ...(record.error === undefined ? {} : { error: record.error }),
      };
      return `${status.serverId}: ${status.state} at ${status.root} (${status.documents} documents)${status.error === undefined ? "" : `: ${status.error}`}`;
    });
    return [...configured, ...active].join("\n") || "No LSP servers configured";
  }

  async warm(path: string): Promise<void> {
    const result = await this.matches(path, true, undefined);
    await Promise.all(result.matches.map(({ client, document }) => client.warm(document)));
  }

  async diagnostics(
    path: string,
    signal: AbortSignal | undefined,
    allowAbsolute = false,
  ): Promise<LspOperationResult> {
    const result = await this.matches(path, allowAbsolute, signal);
    const diagnostics: ServerDiagnostic[] = [];
    const warnings = [...result.warnings];
    for (const match of result.matches) {
      try {
        const items = await match.client.freshDiagnostics(match.document, signal);
        diagnostics.push(
          ...items.map((diagnostic) => ({
            diagnostic,
            path: match.document.canonicalPath,
            serverId: match.server.id,
            text: match.document.text,
          })),
        );
      } catch (cause) {
        appendOperationWarning(warnings, match.server.id, cause, signal);
      }
    }
    return {
      diagnosticCount: diagnostics.length,
      matched: result.matches.length > 0,
      text: renderDiagnostics(this.projectRoot, diagnostics),
      warnings,
    };
  }

  async hover(
    path: string,
    line: number,
    column: number,
    signal: AbortSignal | undefined,
  ): Promise<LspOperationResult> {
    const result = await this.matches(path, false, signal);
    const hovers: ServerHover[] = [];
    const warnings = [...result.warnings];
    for (const match of result.matches) {
      if (match.client.supports("hover") === false) continue;
      try {
        hovers.push({
          hover: await match.client.hover(
            match.document,
            toProtocolPosition(match.document.text, line, column),
            signal,
          ),
          serverId: match.server.id,
        });
      } catch (cause) {
        appendOperationWarning(warnings, match.server.id, cause, signal);
      }
    }
    return { matched: result.matches.length > 0, text: renderHovers(hovers), warnings };
  }

  async definition(
    path: string,
    line: number,
    column: number,
    signal: AbortSignal | undefined,
  ): Promise<LspOperationResult> {
    const result = await this.matches(path, false, signal);
    const groups: ServerLocations[] = [];
    const warnings = [...result.warnings];
    for (const match of result.matches) {
      if (match.client.supports("goto_definition") === false) continue;
      try {
        groups.push({
          locations: normalizedDefinition(
            await match.client.definition(
              match.document,
              toProtocolPosition(match.document.text, line, column),
              signal,
            ),
          ),
          serverId: match.server.id,
        });
      } catch (cause) {
        appendOperationWarning(warnings, match.server.id, cause, signal);
      }
    }
    return {
      matched: result.matches.length > 0,
      text: await renderLocations(this.projectRoot, groups, signal),
      warnings,
    };
  }

  async references(
    path: string,
    line: number,
    column: number,
    includeDeclaration: boolean,
    signal: AbortSignal | undefined,
  ): Promise<LspOperationResult> {
    const result = await this.matches(path, false, signal);
    const groups: ServerLocations[] = [];
    const warnings = [...result.warnings];
    for (const match of result.matches) {
      if (match.client.supports("find_references") === false) continue;
      try {
        groups.push({
          locations:
            (await match.client.references(
              match.document,
              toProtocolPosition(match.document.text, line, column),
              includeDeclaration,
              signal,
            )) ?? [],
          serverId: match.server.id,
        });
      } catch (cause) {
        appendOperationWarning(warnings, match.server.id, cause, signal);
      }
    }
    return {
      matched: result.matches.length > 0,
      text: await renderLocations(this.projectRoot, groups, signal),
      warnings,
    };
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    await Promise.allSettled(
      [...this.instances.values()].map(async (record) => {
        const client = record.client ?? (await record.promise.catch(() => undefined));
        await client?.shutdown();
      }),
    );
    this.instances.clear();
  }

  private async matches(
    path: string,
    allowAbsolute: boolean,
    signal: AbortSignal | undefined,
  ): Promise<MatchResult> {
    if (this.shuttingDown) throw new Error("LSP integration is shutting down");
    if (signal?.aborted) throw new Error("LSP operation cancelled");
    const candidatePath = resolve(this.projectRoot, path);
    const fileName = basename(candidatePath);
    const extension = extname(candidatePath);
    const candidates = this.settings.servers.flatMap((server) => {
      const language = server.languages.find(
        (item) => item.fileNames.includes(fileName) || item.extensions.includes(extension),
      );
      return language === undefined ? [] : [{ language, server }];
    });
    const matches: Match[] = [];
    const warnings: string[] = [];
    for (const { language, server } of candidates) {
      try {
        if (signal?.aborted) throw new Error("LSP operation cancelled");
        const document = await readProjectFile(
          this.projectRoot,
          path,
          language.languageId,
          allowAbsolute,
        );
        if (languageForPath(server, document.path) === undefined) continue;
        const root = await findServerRoot(
          this.projectRoot,
          document.canonicalPath,
          server.rootMarkers,
        );
        if (root === undefined) continue;
        if (this.shuttingDown) throw new Error("LSP integration is shutting down");
        if (signal?.aborted) throw new Error("LSP operation cancelled");
        matches.push({ client: await this.client(server, root, signal), document, server });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        warnings.push(`${server.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    return { matches, warnings };
  }

  private client(
    server: LspServerSettings,
    root: string,
    signal: AbortSignal | undefined,
  ): Promise<LspServerClient> {
    if (this.shuttingDown) return Promise.reject(new Error("LSP integration is shutting down"));
    const key = `${server.id}\0${root}`;
    const existing = this.instances.get(key);
    if (existing !== undefined) return existing.promise;
    if (this.instances.size >= MAX_INSTANCES) {
      return Promise.reject(new Error(`LSP instance limit of ${MAX_INSTANCES} reached`));
    }
    const promise = LspServerClient.start(server, root, this.settings.timeouts, signal);
    const record: InstanceRecord = { promise, root, server };
    void promise.then(
      (client) => {
        record.client = client;
      },
      (cause) => {
        record.error = cause instanceof Error ? cause.message : String(cause);
        if (cause instanceof Error && cause.name === "AbortError") {
          if (this.instances.get(key) === record) this.instances.delete(key);
        }
      },
    );
    this.instances.set(key, record);
    return promise;
  }
}
