import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  isEditToolResult,
  isWriteToolResult,
  SettingsManager,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
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

function mutationPath(event: ToolResultEvent): string | undefined {
  if (event.isError) return undefined;
  if (isEditToolResult(event) === false && isWriteToolResult(event) === false) return undefined;
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
  const manager = SettingsManager.create(context.cwd, agentDirectory, { projectTrusted: true });
  const settings = resolveLspSettings(manager.getGlobalSettings(), manager.getProjectSettings());
  const errors = manager.drainErrors();
  if (errors.length === 0) return settings;
  return {
    servers: [],
    timeouts: settings.timeouts,
    warnings: [
      ...settings.warnings,
      ...errors.map(
        ({ error, path, scope }) =>
          `${scope} settings${path === undefined ? "" : ` (${path})`}: ${error.message}`,
      ),
    ],
  };
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
    let toolRegistered = false;
    const pendingMutations = new Map<string, string>();

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
            "Use lsp after locating a relevant source file when semantic navigation is more precise than text search.",
            "Use one-based line and column positions from source files.",
          ],
          parameters: LspParameters,
          executionMode: "sequential",

          async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (ctx.isProjectTrusted() === false || manager === undefined) {
              throw new Error("LSP integration is unavailable until the project is trusted");
            }
            if (params.operation === "status") {
              return {
                content: [{ type: "text", text: manager.status() }],
                details: { operation: params.operation, warnings: [] },
              };
            }

            let result: LspOperationResult;
            if (params.operation === "diagnostics") {
              result = await manager.diagnostics(params.path, signal);
            } else if (params.operation === "hover") {
              result = await manager.hover(params.path, params.line, params.column, signal);
            } else if (params.operation === "goto_definition") {
              result = await manager.definition(params.path, params.line, params.column, signal);
            } else {
              result = await manager.references(
                params.path,
                params.line,
                params.column,
                params.includeDeclaration ?? true,
                signal,
              );
            }
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
      const path = mutationPath(event);
      if (path !== undefined) pendingMutations.set(event.toolCallId, path);
    });

    // Final tool-result messages are emitted only after every tool_result middleware has settled.
    pi.on("message_end", async (event, context) => {
      if (event.message.role !== "toolResult" || manager === undefined) return;
      const path = pendingMutations.get(event.message.toolCallId);
      if (path === undefined) return;
      pendingMutations.delete(event.message.toolCallId);
      const result = await manager.diagnostics(path, context.signal, true);
      if (result.matched === false && result.warnings.length === 0) return;
      return {
        message: {
          ...event.message,
          content: [
            ...event.message.content,
            { type: "text", text: `LSP diagnostics after formatting:\n${resultText(result)}` },
          ],
        },
      };
    });

    pi.on("session_shutdown", async () => {
      pendingMutations.clear();
      const current = manager;
      manager = undefined;
      await current?.shutdown();
    });
  };
}

export default createLspExtension();
