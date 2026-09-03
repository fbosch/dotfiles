import { resolve } from "node:path";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  isEditToolResult,
  isReadToolResult,
  isWriteToolResult,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { match } from "ts-pattern";
import { type Static, Type } from "typebox";
import { loadExtensionConfigLayers } from "../../lib/extension-config";
import { type LspOperationResult, LspServerManager } from "./server-manager";
import { DEFAULT_LSP_TIMEOUTS, type ResolvedLspSettings, resolveLspSettings } from "./settings";

const PositionFields = {
  column: Type.Integer({ minimum: 1 }),
  line: Type.Integer({ minimum: 1 }),
  path: Type.String({ minLength: 1 }),
};

const LspParameters = Type.Union([
  Type.Object({ operation: Type.Literal("status") }, { additionalProperties: false }),
  Type.Object(
    { operation: Type.Literal("diagnostics"), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { operation: Type.Literal("hover"), ...PositionFields },
    { additionalProperties: false },
  ),
  Type.Object(
    { operation: Type.Literal("goto_definition"), ...PositionFields },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("find_references"),
      ...PositionFields,
      includeDeclaration: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);

type LspInput = Static<typeof LspParameters>;

interface LspToolDetails {
  readonly operation: LspInput["operation"];
  readonly warnings: readonly string[];
}

interface LspExtensionDependencies {
  readonly createManager?: (
    cwd: string,
    settings: ResolvedLspSettings,
  ) => Promise<LspServerManager>;
  readonly readSettings?: (context: ExtensionContext) => ResolvedLspSettings;
}

interface PendingMutation {
  diagnostics?: Promise<LspOperationResult>;
  readonly key: string;
  readonly path: string;
  readonly sequence: number;
}

function mutationPath(event: ToolResultEvent): string | undefined {
  if (event.isError) return undefined;
  if (isEditToolResult(event) === false && isWriteToolResult(event) === false) return undefined;
  const path = event.input.path;
  return typeof path === "string" ? path : undefined;
}

function readPath(event: ToolResultEvent): string | undefined {
  if (event.isError || isReadToolResult(event) === false) return undefined;
  const path = event.input.path;
  return typeof path === "string" ? path : undefined;
}

export function loadLspSettings(
  context: ExtensionContext,
  agentDirectory = getAgentDir(),
): ResolvedLspSettings {
  if (context.isProjectTrusted() === false) {
    return { servers: [], timeouts: DEFAULT_LSP_TIMEOUTS, warnings: [] };
  }
  try {
    const config = loadExtensionConfigLayers("lsp", context, agentDirectory);
    return resolveLspSettings(config.global, config.project);
  } catch (error) {
    return {
      servers: [],
      timeouts: DEFAULT_LSP_TIMEOUTS,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function resultText(result: LspOperationResult): string {
  if (result.warnings.length === 0) return result.text;
  return `${result.text}\n\nLSP warnings:\n- ${result.warnings.join("\n- ")}`;
}

function assertMatched(result: LspOperationResult): void {
  if (result.matched) return;
  const suffix = result.warnings.length === 0 ? "" : `: ${result.warnings.join("; ")}`;
  throw new Error(`No configured LSP server matched this file and project root${suffix}`);
}

export function createLspExtension(dependencies: LspExtensionDependencies = {}) {
  return function lspExtension(pi: ExtensionAPI): void {
    let manager: LspServerManager | undefined;
    let mutationSequence = 0;
    let toolRegistered = false;
    const pendingMutations = new Map<string, PendingMutation>();
    const warmedPaths = new Set<string>();

    pi.on("session_start", async (_event, context) => {
      const settings = (dependencies.readSettings ?? loadLspSettings)(context);
      if (settings.warnings.length > 0) {
        context.ui.notify(`LSP settings:\n- ${settings.warnings.join("\n- ")}`, "warning");
        return;
      }
      if (context.isProjectTrusted() === false) return;
      manager = await (dependencies.createManager ?? LspServerManager.create)(
        context.cwd,
        settings,
      );
      if (toolRegistered) return;
      toolRegistered = true;

      pi.registerTool(
        defineTool<typeof LspParameters, LspToolDetails>({
          name: "lsp",
          label: "Language Server",
          description:
            "Query configured project language servers for diagnostics, hover information, definitions, references, or server status. Paths are project-relative and positions are one-based.",
          promptSnippet: "Query persistent language servers for project code intelligence",
          promptGuidelines: [
            "Use lsp for hover, definitions, or references when semantic navigation is more precise than text search.",
            "Use one-based line and column positions from source files.",
          ],
          parameters: LspParameters,
          executionMode: "sequential",

          async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const activeManager = manager;
            if (ctx.isProjectTrusted() === false || activeManager === undefined) {
              throw new Error("LSP integration is unavailable until the project is trusted");
            }
            if (params.operation === "status") {
              return {
                content: [{ type: "text", text: activeManager.status() }],
                details: { operation: params.operation, warnings: [] },
              };
            }

            const result: LspOperationResult = await match(params)
              .with({ operation: "diagnostics" }, ({ path }) =>
                activeManager.diagnostics(path, signal),
              )
              .with({ operation: "hover" }, ({ path, line, column }) =>
                activeManager.hover(path, line, column, signal),
              )
              .with({ operation: "goto_definition" }, ({ path, line, column }) =>
                activeManager.definition(path, line, column, signal),
              )
              .with(
                { operation: "find_references" },
                ({ path, line, column, includeDeclaration }) =>
                  activeManager.references(path, line, column, includeDeclaration ?? true, signal),
              )
              .exhaustive();
            assertMatched(result);
            return {
              content: [{ type: "text", text: resultText(result) }],
              details: { operation: params.operation, warnings: result.warnings },
            };
          },
        }),
      );
    });

    pi.on("tool_result", (event, context) => {
      if (context.isProjectTrusted() === false) return;
      const path = readPath(event);
      if (path !== undefined && manager !== undefined) {
        const key = resolve(context.cwd, path);
        if (warmedPaths.has(key) === false) {
          warmedPaths.add(key);
          void manager.warm(path).catch(() => undefined);
        }
      }
      const changedPath = mutationPath(event);
      if (changedPath !== undefined) {
        pendingMutations.set(event.toolCallId, {
          key: resolve(context.cwd, changedPath),
          path: changedPath,
          sequence: ++mutationSequence,
        });
      }
    });

    // message_end runs after formatter middleware, so diagnostics can start against final file text.
    pi.on("message_end", (event, context) => {
      if (event.message.role !== "toolResult" || manager === undefined) return;
      const mutation = pendingMutations.get(event.message.toolCallId);
      if (mutation === undefined || mutation.diagnostics !== undefined) return;
      mutation.diagnostics = manager.diagnostics(mutation.path, context.signal, true);
      void mutation.diagnostics.catch(() => undefined);
    });

    pi.on("turn_end", async (event) => {
      const latestByFile = new Map<string, PendingMutation>();
      for (const toolResult of event.toolResults) {
        const mutation = pendingMutations.get(toolResult.toolCallId);
        if (mutation === undefined) continue;
        pendingMutations.delete(toolResult.toolCallId);
        const latest = latestByFile.get(mutation.key);
        if (latest === undefined || mutation.sequence > latest.sequence) {
          latestByFile.set(mutation.key, mutation);
        }
      }

      const reports = (
        await Promise.all(
          [...latestByFile.values()].map(async ({ diagnostics }) => {
            if (diagnostics === undefined) return undefined;
            const result = await diagnostics;
            if (result.diagnosticCount === 0 && result.warnings.length === 0) return undefined;
            if (result.matched === false && result.warnings.length === 0) return undefined;
            return resultText(result);
          }),
        )
      ).filter((report): report is string => report !== undefined);
      if (reports.length === 0) return;

      pi.sendMessage(
        {
          customType: "lsp-diagnostics",
          content: `Automatic LSP diagnostics after edits:\n${reports.join("\n\n")}`,
          display: true,
        },
        { deliverAs: "steer" },
      );
    });

    pi.on("session_shutdown", async () => {
      pendingMutations.clear();
      warmedPaths.clear();
      const current = manager;
      manager = undefined;
      await current?.shutdown();
    });
  };
}

export default createLspExtension();
