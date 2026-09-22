import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExecOptions,
  type ExecResult,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readJsonConfig } from "../../lib/extension-config";
import { PROGRAMMATIC_READ_ONLY } from "../../lib/tool-exposure";
import { diffComponent } from "./rendering";
import {
  DEFAULT_SYNTAX_THEME,
  type DeltaDetails,
  type DeltaEditRequest,
  type DeltaExecutor,
  type DeltaResult,
  diagnostic,
  type EditDiffRunner,
  ENTRY_TYPE,
  FULL_CONTEXT_LINES,
  type GitDiffRequest,
  type GitDiffRunner,
  HASHLINE_DIFF_TOOLS,
  MAX_PATHS,
  normalizeHashlineDiffDetails,
  type RunOptions,
  safeInput,
} from "./shared";

export { applyDiffTheme, renderDiffLines } from "./rendering";
export type {
  DeltaDetails,
  DeltaEditRequest,
  DeltaExecutor,
  DeltaResult,
  EditDiffRunner,
  GitDiffExecutor,
  GitDiffRequest,
  GitDiffRunner,
  RunOptions,
} from "./shared";
export {
  boundDiffOutput,
  buildDeltaInvocation,
  buildGitInvocation,
  normalizeHashlineDiffDetails,
  sanitizeTerminalOutput,
} from "./shared";

const DisplayMode = StringEnum(["auto", "side-by-side", "inline"] as const);

const GitDiffParameters = Type.Object(
  {
    staged: Type.Optional(
      Type.Boolean({ description: "Compare the index instead of unstaged working-tree changes" }),
    ),
    revision: Type.Optional(
      Type.String({
        description:
          "Git revision or range to compare, such as HEAD, HEAD~1, or main...HEAD. Values beginning with '-' are rejected.",
      }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Optional Git pathspecs used after '--'",
        maxItems: MAX_PATHS,
      }),
    ),
    display: Type.Optional(
      Type.Unsafe<"auto" | "side-by-side" | "inline">({
        ...DisplayMode,
        description: "Layout. Auto uses inline output in narrow terminals.",
      }),
    ),
    context: Type.Optional(
      Type.Integer({
        description: "Unchanged lines around each change",
        minimum: 0,
        maximum: 50,
      }),
    ),
  },
  { additionalProperties: false },
);

type HashlineToolExecute = NonNullable<ToolDefinition["execute"]>;
type HashlineDeltaDetails = Record<string, unknown> & { readonly delta?: DeltaDetails };

interface HashlineEditFlags {
  readonly requirePath: boolean;
  readonly strictInput: boolean;
  readonly boundaryDedupMode: "on" | "off" | "strict";
  readonly autoRead: boolean;
}

interface HashlineToolModule {
  readonly buildToolDef?: (flags?: HashlineEditFlags) => ToolDefinition;
  readonly buildInsertToolDef?: (flags?: HashlineEditFlags) => ToolDefinition;
  readonly regUndo?: (pi: ExtensionAPI) => void;
}

interface HashlineEditCommonModule {
  readonly currentEditFlags?: () => Promise<HashlineEditFlags>;
}

async function loadHashlineEditFlags(): Promise<HashlineEditFlags | undefined> {
  try {
    // SAFETY: The pinned hashline module exposes this optional function; absence is handled below.
    const module = (await import(
      new URL("../../npm/node_modules/pi-hashline-edit-pro/src/edit-common.ts", import.meta.url)
        .href
    )) as unknown as HashlineEditCommonModule;
    return await module.currentEditFlags?.();
  } catch {
    // Hashline 3.x has no configurable edit flags; its builders use the legacy schema.
    return undefined;
  }
}

export async function loadHashlineDeltaTools(): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const flags = await loadHashlineEditFlags();
  try {
    // SAFETY: The pinned hashline replace module exposes the optional builder checked below.
    const replaceModule = (await import(
      new URL("../../npm/node_modules/pi-hashline-edit-pro/src/replace.ts", import.meta.url).href
    )) as unknown as HashlineToolModule;
    if (replaceModule.buildToolDef !== undefined) tools.push(replaceModule.buildToolDef(flags));
  } catch {
    return tools;
  }

  try {
    // SAFETY: The pinned hashline insert module exposes the optional builder checked below.
    const insertModule = (await import(
      new URL("../../npm/node_modules/pi-hashline-edit-pro/src/insert.ts", import.meta.url).href
    )) as unknown as HashlineToolModule;
    if (insertModule.buildInsertToolDef !== undefined) {
      tools.push(insertModule.buildInsertToolDef(flags));
    }
  } catch {
    // Replace remains useful when the optional insert module is unavailable.
  }
  try {
    // SAFETY: The pinned hashline undo module exposes the optional registration hook checked below.
    const undoModule = (await import(
      new URL("../../npm/node_modules/pi-hashline-edit-pro/src/replace-undo.ts", import.meta.url)
        .href
    )) as unknown as HashlineToolModule;
    const registeredTools: ToolDefinition[] = [];
    // Hashline exposes undo through registration rather than a definition builder.
    // SAFETY: regUndo only calls registerTool on this deliberately minimal API adapter.
    undoModule.regUndo?.({
      registerTool(tool: ToolDefinition) {
        registeredTools.push(tool);
      },
    } as unknown as ExtensionAPI);
    tools.push(...registeredTools.filter((tool) => tool.name === "undo_last_change"));
  } catch {
    // Replace and insert remain useful when the optional undo module is unavailable.
  }
  return tools;
}

function hashlinePath(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const path = (value as Record<string, unknown>).path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

async function readHashlineFile(path: string, cwd: string): Promise<string | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(resolve(cwd, path.replace(/^@/u, "")), "utf8");
  } catch {
    return undefined;
  }
}

function isDeltaDetails(value: unknown): value is DeltaDetails {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.display === "inline" || record.display === "side-by-side") &&
    typeof record.noChanges === "boolean" &&
    typeof record.output === "string" &&
    typeof record.scope === "string" &&
    typeof record.width === "number"
  );
}

function wrapHashlineTool(tool: ToolDefinition, runEdit: EditDiffRunner): ToolDefinition {
  const originalExecute = tool.execute;
  const originalRenderResult = tool.renderResult;
  if (originalExecute === undefined || originalRenderResult === undefined) return tool;

  const execute: HashlineToolExecute = async (toolCallId, params, signal, onUpdate, ctx) => {
    const cwd = ctx.cwd;
    const path = hashlinePath(params);
    const oldContent = path === undefined ? undefined : await readHashlineFile(path, cwd);
    const result = await originalExecute(toolCallId, params, signal, onUpdate, ctx);
    if (path === undefined || oldContent === undefined) return result;

    const newContent = await readHashlineFile(path, cwd);
    if (newContent === undefined || newContent === oldContent) return result;

    try {
      const delta = await runEdit({ path, oldContent, newContent }, cwd, signal);
      return {
        ...result,
        details: {
          ...((result.details ?? {}) as Record<string, unknown>),
          delta,
        } as HashlineDeltaDetails,
      };
    } catch {
      return result;
    }
  };

  const renderCall: NonNullable<ToolDefinition["renderCall"]> = (args, theme) => {
    const path = hashlinePath(args);
    const label = theme.fg("toolTitle", theme.bold(tool.name));
    return new Text(path === undefined ? label : `${label} ${theme.fg("accent", path)}`, 0, 0);
  };

  const renderResult: NonNullable<ToolDefinition["renderResult"]> = (
    result,
    options,
    theme,
    context,
  ) => {
    const details = result.details as HashlineDeltaDetails | undefined;
    if (!context.isError && !options.isPartial && isDeltaDetails(details?.delta)) {
      // Auto-read puts the anchored diff in content for the model, not a second UI preview.
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      const warning = [
        details.delta.warning,
        text.match(/(?:^|\n)Warnings:\n([\s\S]*)$/u)?.[1]?.trim(),
      ]
        .filter((value) => value !== undefined && value !== "")
        .join("\n");
      return diffComponent(
        warning === "" ? details.delta : { ...details.delta, warning },
        options.expanded === true || context.expanded === true,
        theme,
      );
    }
    return originalRenderResult(result, options, theme, context);
  };

  return { ...tool, execute, renderCall, renderResult };
}

interface GitDiffRenderState {
  expandedController: AbortController | undefined;
  expandedDetails: DeltaDetails | null | undefined;
  expandedKey: string | undefined;
  expandedPending: boolean;
}

function renderExpandedGitDiff(
  details: DeltaDetails,
  request: GitDiffRequest,
  cwd: string,
  state: GitDiffRenderState,
  run: GitDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DeltaDetails {
  if (details.noChanges) return details;

  const expandedRequest = { ...request, context: FULL_CONTEXT_LINES };
  const requestKey = JSON.stringify(expandedRequest);
  if (state.expandedKey !== requestKey) {
    state.expandedController?.abort();
    if (state.expandedController !== undefined) {
      expansionControllers.delete(state.expandedController);
    }
    state.expandedController = undefined;
    state.expandedDetails = undefined;
    state.expandedKey = requestKey;
    state.expandedPending = false;
  }

  if (!state.expandedPending && state.expandedDetails === undefined) {
    const controller = new AbortController();
    state.expandedController = controller;
    state.expandedPending = true;
    expansionControllers.add(controller);
    void run(expandedRequest, cwd, controller.signal).then(
      (expandedResult) => {
        expansionControllers.delete(controller);
        if (
          state.expandedKey !== requestKey ||
          state.expandedController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedDetails = expandedResult.details;
        state.expandedPending = false;
        state.expandedController = undefined;
        invalidate();
      },
      () => {
        expansionControllers.delete(controller);
        if (
          state.expandedKey !== requestKey ||
          state.expandedController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedDetails = null;
        state.expandedPending = false;
        state.expandedController = undefined;
        invalidate();
      },
    );
  }

  return state.expandedDetails ?? details;
}

export interface DeltaConfig {
  readonly editPreviews?: boolean;
  readonly syntaxTheme?: string;
}

type ExecutionModule = typeof import("./execution");
type CommandModule = typeof import("./command");
type EditPreviewModule = typeof import("./edit-preview");

export interface DeltaExtensionDependencies {
  readonly columns?: () => number | undefined;
  readonly config?: DeltaConfig;
  readonly editPreviews?: (context: ExtensionContext) => boolean;
  readonly executeDelta?: DeltaExecutor;
  readonly loadCommand?: () => Promise<CommandModule>;
  readonly loadEditPreview?: () => Promise<EditPreviewModule>;
  readonly loadExecution?: () => Promise<ExecutionModule>;
  readonly run?: GitDiffRunner;
  readonly runEdit?: EditDiffRunner;
  readonly hashlineTools?: readonly ToolDefinition[];
  readonly loadHashlineTools?: () => Promise<readonly ToolDefinition[]>;
}

export function loadDeltaConfig(agentDirectory = getAgentDir()): DeltaConfig {
  const value = readJsonConfig(join(agentDirectory, "settings.json"));
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi settings: expected an object");
  }

  const settings = value as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const field of ["editPreviews", "syntaxTheme"]) {
    if (settings[field] !== undefined) config[field] = settings[field];
  }

  if (config.editPreviews !== undefined && typeof config.editPreviews !== "boolean") {
    throw new Error("settings.editPreviews: expected a boolean");
  }
  if (config.syntaxTheme !== undefined) {
    if (typeof config.syntaxTheme !== "string" || config.syntaxTheme.trim() === "") {
      throw new Error("settings.syntaxTheme: expected a non-empty string");
    }
    if (config.syntaxTheme.includes("\0") || /\p{C}/u.test(config.syntaxTheme)) {
      throw new Error("settings.syntaxTheme must not contain control characters");
    }
  }

  return config as DeltaConfig;
}

export function registerDeltaExtension(
  pi: ExtensionAPI,
  dependencies: DeltaExtensionDependencies = {},
): void {
  const config = dependencies.config ?? loadDeltaConfig();
  const syntaxTheme = config.syntaxTheme ?? DEFAULT_SYNTAX_THEME;
  const loadExecution = dependencies.loadExecution ?? (() => import("./execution"));
  let executionModule: Promise<ExecutionModule> | undefined;
  const getExecution = () => (executionModule ??= loadExecution());
  const executeDelta =
    dependencies.executeDelta ??
    ((args: readonly string[], input: string | undefined, options: ExecOptions) =>
      getExecution().then(({ executeDeltaProcess }) => executeDeltaProcess(args, input, options)));
  const run: GitDiffRunner =
    dependencies.run ??
    ((request, cwd, signal) =>
      getExecution().then(({ runDeltaGitDiff }) =>
        runDeltaGitDiff((command, args, options) => pi.exec(command, args, options), request, cwd, {
          columns: dependencies.columns?.() ?? process.stdout.columns,
          executeDelta,
          ...(signal === undefined ? {} : { signal }),
          syntaxTheme,
        }),
      ));
  const runEdit: EditDiffRunner =
    dependencies.runEdit ??
    ((request, cwd, signal) =>
      getExecution().then(({ runDeltaEditDiff }) =>
        runDeltaEditDiff(executeDelta, request, cwd, {
          columns: dependencies.columns?.() ?? process.stdout.columns,
          ...(signal === undefined ? {} : { signal }),
          syntaxTheme,
        }),
      ));

  const previewControllers = new Set<AbortController>();
  const expansionControllers = new Set<AbortController>();
  const shouldUseEditPreviews = dependencies.editPreviews ?? (() => config.editPreviews === true);
  const loadHashlineTools = dependencies.loadHashlineTools ?? loadHashlineDeltaTools;
  const loadEditPreview = dependencies.loadEditPreview ?? (() => import("./edit-preview"));
  const loadCommand = dependencies.loadCommand ?? (() => import("./command"));
  interface SessionState {
    readonly cwd: string;
    readonly editPreviews: boolean;
    hashlineRegistration?: Promise<void>;
  }
  let activeSession: SessionState | undefined;
  const registerHashlineDeltaTools = (session: SessionState): Promise<void> => {
    if (session.hashlineRegistration === undefined) {
      session.hashlineRegistration = (async () => {
        const tools = dependencies.hashlineTools ?? (await loadHashlineTools());
        if (activeSession !== session) return;
        for (const tool of tools) {
          pi.registerTool(wrapHashlineTool(tool, runEdit));
        }
      })();
    }
    return session.hashlineRegistration;
  };
  pi.on("tool_result", (event) => {
    if (!HASHLINE_DIFF_TOOLS.has(event.toolName)) return;
    // Auto-read consumes diff after this hook; Delta-backed results need no UI normalization here.
    if (isDeltaDetails((event.details as HashlineDeltaDetails | undefined)?.delta)) return;
    const details = normalizeHashlineDiffDetails(event.details);
    if (details === event.details) return;
    return { details };
  });

  pi.on("session_shutdown", () => {
    activeSession = undefined;
    for (const controller of previewControllers) controller.abort();
    for (const controller of expansionControllers) controller.abort();
    previewControllers.clear();
    expansionControllers.clear();
  });

  pi.on("session_start", async (_event, ctx) => {
    const editPreviews = shouldUseEditPreviews(ctx);
    const session: SessionState = { cwd: ctx.cwd, editPreviews };
    activeSession = session;
    if (!editPreviews) return;
    const { createDeltaEditTool } = await loadEditPreview();
    if (activeSession !== session) return;
    pi.registerTool(createDeltaEditTool(ctx.cwd, runEdit, previewControllers));
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const session = activeSession;
    if (session === undefined || !session.editPreviews || session.cwd !== ctx.cwd) return;
    await registerHashlineDeltaTools(session);
  });

  pi.registerEntryRenderer<DeltaDetails>(ENTRY_TYPE, (entry, { expanded }, theme) => {
    const details = entry.data;
    return details === undefined
      ? new Text(theme.fg("warning", "Delta diff data is unavailable."), 0, 0)
      : diffComponent(details, expanded, theme);
  });

  pi.registerTool(
    defineTool<typeof GitDiffParameters, DeltaDetails, GitDiffRenderState>({
      ...PROGRAMMATIC_READ_ONLY,
      name: "git_diff",
      label: "Delta Git diff",
      description:
        "Render a read-only syntax-highlighted Git diff with Delta. Supports unstaged or staged changes, one revision/range, and optional pathspecs. Untracked files are excluded. Output is truncated to 2000 lines or 50KB; full truncated output is saved to a temporary file.",
      promptSnippet: "Render syntax-highlighted Git diffs with Delta",
      promptGuidelines: [
        "Use git_diff instead of bash when visually inspecting textual Git changes; use git status for summaries and git diff --check for validation.",
      ],
      parameters: GitDiffParameters,

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const result = await run(params, ctx.cwd, signal);
        return {
          content: [{ type: "text", text: result.content }],
          details: result.details,
        };
      },

      renderCall(args, theme) {
        const parts = [theme.fg("toolTitle", theme.bold("git diff"))];
        if (args.staged === true) parts.push(theme.fg("accent", "--staged"));
        if (args.revision !== undefined) {
          parts.push(theme.fg("accent", safeInput(args.revision, "Git revision")));
        }
        if (args.paths !== undefined && args.paths.length > 0) {
          const pathSummary = `${args.paths.length} ${args.paths.length === 1 ? "path" : "paths"}`;
          parts.push(theme.fg("muted", `-- ${pathSummary}`));
        }
        return new Text(parts.join(" "), 0, 0);
      },

      renderResult(result, { expanded }, theme, context) {
        const details = expanded
          ? renderExpandedGitDiff(
              result.details,
              context.args,
              context.cwd,
              context.state,
              run,
              expansionControllers,
              context.invalidate,
            )
          : result.details;
        const component = new Container();
        component.addChild(new Spacer(1));
        component.addChild(
          diffComponent(details, expanded, theme, expanded && context.state.expandedPending),
        );
        return component;
      },
    }),
  );

  pi.registerCommand("delta", {
    description: "Show the unstaged syntax-highlighted Git diff",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input === "-h" || input === "--help") {
        ctx.ui.notify(commandHelp(), "info");
        return;
      }
      if (input !== "") {
        ctx.ui.notify(commandHelp(), "error");
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("/delta requires interactive mode.", "error");
        return;
      }

      try {
        const { runDeltaCommand } = await loadCommand();
        await runDeltaCommand(ctx, run, (details) => {
          pi.appendEntry<DeltaDetails>(ENTRY_TYPE, details);
        });
      } catch (error) {
        ctx.ui.notify(diagnostic(error instanceof Error ? error.message : String(error)), "error");
      }
    },
  });
}

function commandHelp(): string {
  return [
    "Usage: /delta",
    "",
    "Show unstaged working-tree changes using Delta.",
    "Ask the agent to use `git_diff` for staged changes, revisions, or path filters.",
    "Set `editPreviews` to true in ~/.pi/agent/settings.json to use Delta for edit previews.",
  ].join("\n");
}

export async function executeDeltaProcess(
  args: readonly string[],
  input: string | undefined,
  options: ExecOptions,
): Promise<ExecResult> {
  const { executeDeltaProcess: execute } = await import("./execution");
  return execute(args, input, options);
}

export async function runDeltaGitDiff(
  executeGit: import("./shared").GitDiffExecutor,
  request: GitDiffRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DeltaResult> {
  const { runDeltaGitDiff: run } = await import("./execution");
  return run(executeGit, request, cwd, options);
}

export async function runDeltaEditDiff(
  executeDelta: DeltaExecutor,
  request: DeltaEditRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DeltaDetails> {
  const { runDeltaEditDiff: run } = await import("./execution");
  return run(executeDelta, request, cwd, options);
}

export default function deltaExtension(pi: ExtensionAPI): void {
  registerDeltaExtension(pi);
}
