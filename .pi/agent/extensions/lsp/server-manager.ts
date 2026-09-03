import { basename, extname, resolve } from "node:path";
import type { Location, LocationLink } from "vscode-languageserver-protocol/node";
import { renderDiagnostics, renderHovers, renderLocations } from "./output";
import {
  canonicalProjectRoot,
  findServerRoot,
  languageForPath,
  type ProjectFile,
  readProjectFile,
} from "./paths";
import { toProtocolPosition } from "./positions";
import { type ClientStatus, type DiagnosticObservation, LspServerClient } from "./server-client";
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

export type DiagnosticVerdict = "issues" | "clean" | "unconfirmed" | "partial" | "unavailable";

export type LspDiagnosticEvidence =
  | {
      readonly kind: "pull-report";
      readonly reportKind: "full" | "unchanged";
      readonly serverId: string;
    }
  | {
      readonly kind: "push-publication";
      readonly serverId: string;
    };

export interface LspOperationResult {
  readonly diagnosticCount?: number;
  readonly diagnosticEvidence?: readonly LspDiagnosticEvidence[];
  readonly diagnosticVerdict?: DiagnosticVerdict;
  readonly matched: boolean;
  readonly text: string;
  readonly unconfirmedServers?: readonly string[];
  readonly warnings: readonly string[];
}

interface ServerDiagnosticResult {
  readonly diagnostics: readonly ReturnType<typeof diagnosticRow>[];
  readonly evidence: LspDiagnosticEvidence | undefined;
  readonly observationKind: DiagnosticObservation["kind"];
  readonly serverId: string;
}

function diagnosticRow(
  diagnostic: Parameters<typeof renderDiagnostics>[1][number]["diagnostic"],
  document: ProjectFile,
  serverId: string,
) {
  return {
    diagnostic,
    path: document.canonicalPath,
    serverId,
    text: document.text,
  };
}

function nativeDiagnosticEvidence(
  observation: DiagnosticObservation,
  serverId: string,
): LspDiagnosticEvidence | undefined {
  if (observation.kind === "pull-report") {
    return { kind: observation.kind, reportKind: observation.reportKind, serverId };
  }
  if (observation.kind === "push-publication") return { kind: observation.kind, serverId };
  return undefined;
}

function diagnosticVerdict(
  results: readonly ServerDiagnosticResult[],
  warningCount: number,
): DiagnosticVerdict {
  if (results.length === 0) return "unavailable";
  const diagnosticCount = results.reduce((count, result) => count + result.diagnostics.length, 0);
  const hasPushSilence = results.some((result) => result.observationKind === "push-silence");
  if (warningCount > 0 || (diagnosticCount > 0 && hasPushSilence)) return "partial";
  if (diagnosticCount > 0) return "issues";
  return hasPushSilence ? "unconfirmed" : "clean";
}

function evidenceLabel(evidence: LspDiagnosticEvidence): string {
  if (evidence.kind === "pull-report") {
    return `${evidence.serverId}=textDocument/diagnostic ${evidence.reportKind} report`;
  }
  return `${evidence.serverId}=textDocument/publishDiagnostics notification`;
}

function diagnosticText(
  projectRoot: string,
  results: readonly ServerDiagnosticResult[],
  verdict: DiagnosticVerdict,
): string {
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const evidence = results.flatMap((result) =>
    result.evidence === undefined ? [] : [result.evidence],
  );
  const unconfirmedServers = results
    .filter((result) => result.observationKind === "push-silence")
    .map((result) => result.serverId);
  const sections = [
    `LSP extension verdict: ${verdict}`,
    `LSP-native evidence: ${evidence.length === 0 ? "none" : evidence.map(evidenceLabel).join(", ")}`,
  ];
  if (unconfirmedServers.length > 0) {
    sections.push(
      `Missing LSP-native evidence: ${unconfirmedServers.join(", ")} sent no textDocument/publishDiagnostics notification within the bounded wait`,
    );
  }
  if (diagnostics.length > 0) sections.push(renderDiagnostics(projectRoot, diagnostics));
  return sections.join("\n");
}

function normalizedDefinition(
  result: Location | Location[] | LocationLink[] | null,
): readonly (Location | LocationLink)[] {
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

function operationWarning(
  serverId: string,
  cause: unknown,
  signal: AbortSignal | undefined,
): string {
  if (signal?.aborted) throw cause;
  return `${serverId}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

interface MatchedOperationResult<T> {
  readonly value?: T;
  readonly warning?: string;
}

async function runMatched<T>(
  matches: readonly Match[],
  signal: AbortSignal | undefined,
  operation: (match: Match) => Promise<T | undefined>,
): Promise<{ readonly values: readonly T[]; readonly warnings: readonly string[] }> {
  // Promise.all preserves configured server order while requests run concurrently.
  const results = await Promise.all(
    matches.map(async (match): Promise<MatchedOperationResult<T>> => {
      try {
        const value = await operation(match);
        return value === undefined ? {} : { value };
      } catch (cause) {
        return { warning: operationWarning(match.server.id, cause, signal) };
      }
    }),
  );
  return {
    values: results.flatMap(({ value }) => (value === undefined ? [] : [value])),
    warnings: results.flatMap(({ warning }) => (warning === undefined ? [] : [warning])),
  };
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
        unconfirmedDocuments: 0,
        ...(record.error === undefined ? {} : { error: record.error }),
      };
      const unconfirmed =
        status.unconfirmedDocuments === 0
          ? ""
          : `, ${status.unconfirmedDocuments} unconfirmed diagnostics`;
      return `${status.serverId}: ${status.state} at ${status.root} (${status.documents} documents${unconfirmed})${status.error === undefined ? "" : `: ${status.error}`}`;
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
    const operation = await runMatched(result.matches, signal, async (match) => {
      const observation = await match.client.freshDiagnostics(match.document, signal);
      return {
        diagnostics: observation.diagnostics.map((diagnostic) =>
          diagnosticRow(diagnostic, match.document, match.server.id),
        ),
        evidence: nativeDiagnosticEvidence(observation, match.server.id),
        observationKind: observation.kind,
        serverId: match.server.id,
      } satisfies ServerDiagnosticResult;
    });
    const warnings = [...result.warnings, ...operation.warnings];
    const verdict = diagnosticVerdict(operation.values, warnings.length);
    const diagnosticCount = operation.values.reduce(
      (count, observation) => count + observation.diagnostics.length,
      0,
    );
    return {
      diagnosticCount,
      diagnosticEvidence: operation.values.flatMap((observation) =>
        observation.evidence === undefined ? [] : [observation.evidence],
      ),
      diagnosticVerdict: verdict,
      matched: result.matches.length > 0,
      text: diagnosticText(this.projectRoot, operation.values, verdict),
      unconfirmedServers: operation.values
        .filter((observation) => observation.observationKind === "push-silence")
        .map((observation) => observation.serverId),
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
    const operation = await runMatched(result.matches, signal, async (match) => {
      if (match.client.supports("hover") === false) return undefined;
      return {
        hover: await match.client.hover(
          match.document,
          toProtocolPosition(match.document.text, line, column),
          signal,
        ),
        serverId: match.server.id,
      };
    });
    return {
      matched: result.matches.length > 0,
      text: renderHovers(operation.values),
      warnings: [...result.warnings, ...operation.warnings],
    };
  }

  async definition(
    path: string,
    line: number,
    column: number,
    signal: AbortSignal | undefined,
  ): Promise<LspOperationResult> {
    const result = await this.matches(path, false, signal);
    const operation = await runMatched(result.matches, signal, async (match) => {
      if (match.client.supports("goto_definition") === false) return undefined;
      return {
        locations: normalizedDefinition(
          await match.client.definition(
            match.document,
            toProtocolPosition(match.document.text, line, column),
            signal,
          ),
        ),
        serverId: match.server.id,
      };
    });
    return {
      matched: result.matches.length > 0,
      text: await renderLocations(this.projectRoot, operation.values, signal),
      warnings: [...result.warnings, ...operation.warnings],
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
    const operation = await runMatched(result.matches, signal, async (match) => {
      if (match.client.supports("find_references") === false) return undefined;
      return {
        locations:
          (await match.client.references(
            match.document,
            toProtocolPosition(match.document.text, line, column),
            includeDeclaration,
            signal,
          )) ?? [],
        serverId: match.server.id,
      };
    });
    return {
      matched: result.matches.length > 0,
      text: await renderLocations(this.projectRoot, operation.values, signal),
      warnings: [...result.warnings, ...operation.warnings],
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
    // Promise.all preserves configured server order while roots and clients resolve concurrently.
    const results = await Promise.all(
      candidates.map(async ({ language, server }): Promise<{ match?: Match; warning?: string }> => {
        try {
          if (signal?.aborted) throw new Error("LSP operation cancelled");
          const document = await readProjectFile(
            this.projectRoot,
            path,
            language.languageId,
            allowAbsolute,
          );
          if (languageForPath(server, document.path) === undefined) return {};
          const root = await findServerRoot(
            this.projectRoot,
            document.canonicalPath,
            server.rootMarkers,
          );
          if (root === undefined) return {};
          if (this.shuttingDown) throw new Error("LSP integration is shutting down");
          if (signal?.aborted) throw new Error("LSP operation cancelled");
          return {
            match: { client: await this.client(server, root, signal), document, server },
          };
        } catch (cause) {
          return { warning: operationWarning(server.id, cause, signal) };
        }
      }),
    );
    return {
      matches: results.flatMap(({ match }) => (match === undefined ? [] : [match])),
      warnings: results.flatMap(({ warning }) => (warning === undefined ? [] : [warning])),
    };
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
