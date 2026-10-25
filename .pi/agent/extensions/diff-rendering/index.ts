import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readJsonConfig } from "../../lib/extension-config";
import { INACTIVE_SPECIALIST_TOOL, PROGRAMMATIC_READ_ONLY } from "../../lib/tool-exposure";
import { registerHashlineRendering } from "./hashline-rendering";
import { diffComponent } from "./rendering";
import {
  DEFAULT_SYNTAX_THEME,
  type DiffDetails,
  type DiffRenderEngine,
  type DiffResult,
  diagnostic,
  type EditDiffRequest,
  type EditDiffRunner,
  ENTRY_TYPE,
  FULL_CONTEXT_LINES,
  type GitDiffRequest,
  type GitDiffRunner,
  isDiffDetails,
  MAX_PATHS,
  type RunOptions,
  safeInput,
} from "./shared";

export { applyDiffTheme, renderDiffLines } from "./rendering";
export type {
  DiffDetails,
  DiffRenderEngine,
  DiffResult,
  EditDiffRequest,
  EditDiffRunner,
  GitDiffExecutor,
  GitDiffRequest,
  GitDiffRunner,
  RunOptions,
} from "./shared";
export {
  boundDiffOutput,
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
type HashlineDiffDetails = Record<string, unknown> & { readonly diffRendering?: DiffDetails };

interface HashlineEditFlags {
  readonly requirePath: boolean;
  readonly strictInput: boolean;
  readonly boundaryDedupMode: "on" | "off" | "strict";
  readonly autoRead: boolean;
}

interface HashlineToolModule {
  readonly buildToolDef?: (flags?: HashlineEditFlags) => ToolDefinition;
  readonly buildInsertToolDef?: (flags?: HashlineEditFlags) => ToolDefinition;
  readonly buildReplaceMatchToolDef?: (flags?: HashlineEditFlags) => ToolDefinition;
  readonly buildTransferToolDef?: (
    kind: "copy" | "move",
    flags?: HashlineEditFlags,
  ) => ToolDefinition;
  readonly regUndo?: (pi: ExtensionAPI, flags?: HashlineEditFlags) => void;
  readonly regRead?: (pi: ExtensionAPI, flags?: HashlineEditFlags) => void;
  readonly regGrep?: (pi: ExtensionAPI, flags?: HashlineEditFlags) => void;
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

export async function loadHashlineDiffTools(): Promise<ToolDefinition[]> {
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
  for (const [modulePath, build] of [
    ["replace-match.ts", (module: HashlineToolModule) => module.buildReplaceMatchToolDef?.(flags)],
    ["copy-move.ts", (module: HashlineToolModule) => module.buildTransferToolDef?.("copy", flags)],
    ["copy-move.ts", (module: HashlineToolModule) => module.buildTransferToolDef?.("move", flags)],
  ] as const) {
    try {
      // SAFETY: Each listed installed hashline module exports its corresponding builder.
      const module = (await import(
        new URL(`../../npm/node_modules/pi-hashline-edit-pro/src/${modulePath}`, import.meta.url)
          .href
      )) as unknown as HashlineToolModule;
      const tool = build(module);
      if (tool !== undefined) tools.push(tool);
    } catch {
      // Other available hashline tools remain usable if an optional builder is unavailable.
    }
  }

  for (const modulePath of ["read.ts", "grep.ts"] as const) {
    try {
      // SAFETY: read.ts and grep.ts expose the matching registration functions.
      const module = (await import(
        new URL(`../../npm/node_modules/pi-hashline-edit-pro/src/${modulePath}`, import.meta.url)
          .href
      )) as unknown as HashlineToolModule;
      const registeredTools: ToolDefinition[] = [];
      const register = modulePath === "read.ts" ? module.regRead : module.regGrep;
      // SAFETY: These registrations only call registerTool on the capture adapter.
      register?.(
        {
          registerTool(tool: ToolDefinition) {
            registeredTools.push(tool);
          },
        } as unknown as ExtensionAPI,
        flags,
      );
      tools.push(...registeredTools);
    } catch {
      // Keep remaining tools when an optional read/search module is unavailable.
    }
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

function wrapHashlineTool(tool: ToolDefinition, runEdit: EditDiffRunner): ToolDefinition {
  const originalExecute = tool.execute;
  const originalRenderResult = tool.renderResult;
  if (originalExecute === undefined || originalRenderResult === undefined) return tool;

  const execute: HashlineToolExecute = async (toolCallId, params, signal, onUpdate, ctx) => {
    // Transfer results carry the actual destination (and source for moves); a single-path snapshot loses that evidence.
    if (tool.name === "copy" || tool.name === "move")
      return originalExecute(toolCallId, params, signal, onUpdate, ctx);
    const cwd = ctx.cwd;
    const path = hashlinePath(params);
    const oldContent = path === undefined ? undefined : await readHashlineFile(path, cwd);
    const result = await originalExecute(toolCallId, params, signal, onUpdate, ctx);
    if (path === undefined || oldContent === undefined) return result;

    const newContent = await readHashlineFile(path, cwd);
    if (newContent === undefined || newContent === oldContent) return result;

    try {
      const diffRendering = await runEdit({ path, oldContent, newContent }, cwd, signal);
      return {
        ...result,
        details: {
          ...((result.details ?? {}) as Record<string, unknown>),
          diffRendering,
        } as HashlineDiffDetails,
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
    const details = result.details as HashlineDiffDetails | undefined;
    if (!context.isError && !options.isPartial && isDiffDetails(details?.diffRendering)) {
      // Auto-read puts the anchored diff in content for the model, not a second UI preview.
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      const warning = [
        details.diffRendering.warning,
        text.match(/(?:^|\n)Warnings:\n([\s\S]*)$/u)?.[1]?.trim(),
      ]
        .filter((value) => value !== undefined && value !== "")
        .join("\n");
      return diffComponent(
        warning === "" ? details.diffRendering : { ...details.diffRendering, warning },
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
  expandedDetails: DiffDetails | null | undefined;
  expandedKey: string | undefined;
  expandedPending: boolean;
}

function renderExpandedGitDiff(
  details: DiffDetails,
  request: GitDiffRequest,
  cwd: string,
  state: GitDiffRenderState,
  run: GitDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DiffDetails {
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

export interface DiffRenderingConfig {
  readonly editPreviews?: boolean;
  readonly syntaxTheme?: string;
}

type ExecutionModule = typeof import("./execution");
type CommandModule = typeof import("./command");
type EditPreviewModule = typeof import("./edit-preview");

export interface DiffRenderingDependencies {
  readonly columns?: () => number | undefined;
  readonly config?: DiffRenderingConfig;
  readonly editPreviews?: (context: ExtensionContext) => boolean;
  readonly engine?: DiffRenderEngine;
  readonly loadCommand?: () => Promise<CommandModule>;
  readonly loadEditPreview?: () => Promise<EditPreviewModule>;
  readonly loadExecution?: () => Promise<ExecutionModule>;
  readonly run?: GitDiffRunner;
  readonly runEdit?: EditDiffRunner;
  readonly hashlineTools?: readonly ToolDefinition[];
  readonly loadHashlineTools?: () => Promise<readonly ToolDefinition[]>;
}

export function loadDiffRenderingConfig(agentDirectory = getAgentDir()): DiffRenderingConfig {
  const value = readJsonConfig(join(agentDirectory, "settings.json"));
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi settings: expected an object");
  }

  const settings = (value as Record<string, unknown>).diffRendering;
  if (settings === undefined) return {};
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    throw new Error("settings.diffRendering: expected an object");
  }
  const fields = settings as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const field of ["editPreviews", "syntaxTheme"]) {
    if (fields[field] !== undefined) config[field] = fields[field];
  }

  if (config.editPreviews !== undefined && typeof config.editPreviews !== "boolean") {
    throw new Error("settings.diffRendering.editPreviews: expected a boolean");
  }
  if (config.syntaxTheme !== undefined) {
    if (typeof config.syntaxTheme !== "string" || config.syntaxTheme.trim() === "") {
      throw new Error("settings.diffRendering.syntaxTheme: expected a non-empty string");
    }
    if (config.syntaxTheme.includes("\0") || /\p{C}/u.test(config.syntaxTheme)) {
      throw new Error("settings.diffRendering.syntaxTheme must not contain control characters");
    }
  }

  return config as DiffRenderingConfig;
}

export function registerDiffRenderingExtension(
  pi: ExtensionAPI,
  dependencies: DiffRenderingDependencies = {},
): void {
  const config = dependencies.config ?? loadDiffRenderingConfig();
  const syntaxTheme = config.syntaxTheme ?? DEFAULT_SYNTAX_THEME;
  const loadExecution = dependencies.loadExecution ?? (() => import("./execution"));
  let executionModule: Promise<ExecutionModule> | undefined;
  const getExecution = () => (executionModule ??= loadExecution());
  let enginePromise: Promise<DiffRenderEngine> | undefined;
  const getEngine = () =>
    (enginePromise ??= dependencies.engine
      ? Promise.resolve(dependencies.engine)
      : import("./engine").then(({ createDiffRenderer }) => createDiffRenderer(syntaxTheme)));
  const run: GitDiffRunner =
    dependencies.run ??
    (async (request, cwd, signal) => {
      signal?.throwIfAborted();
      const engine = await getEngine();
      signal?.throwIfAborted();
      const { runGitDiff } = await getExecution();
      return runGitDiff((command, args, options) => pi.exec(command, args, options), request, cwd, {
        columns: dependencies.columns?.() ?? process.stdout.columns,
        engine,
        ...(signal ? { signal } : {}),
      });
    });
  const runEdit: EditDiffRunner =
    dependencies.runEdit ??
    (async (request, cwd, signal) => {
      signal?.throwIfAborted();
      const engine = await getEngine();
      signal?.throwIfAborted();
      const { runEditDiff } = await getExecution();
      return runEditDiff(request, cwd, {
        columns: dependencies.columns?.() ?? process.stdout.columns,
        engine,
        ...(signal ? { signal } : {}),
      });
    });

  const previewControllers = new Set<AbortController>();
  const expansionControllers = new Set<AbortController>();
  const shouldUseEditPreviews = dependencies.editPreviews ?? (() => config.editPreviews === true);
  const loadHashlineTools = dependencies.loadHashlineTools ?? loadHashlineDiffTools;
  const loadEditPreview = dependencies.loadEditPreview ?? (() => import("./edit-preview"));
  const loadCommand = dependencies.loadCommand ?? (() => import("./command"));
  interface SessionState {
    readonly cwd: string;
    readonly editPreviews: boolean;
    hashlineRegistration?: Promise<void>;
  }
  let activeSession: SessionState | undefined;
  const registerHashlineDiffTools = (session: SessionState): Promise<void> => {
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

  pi.on("session_shutdown", async () => {
    activeSession = undefined;
    for (const controller of previewControllers) controller.abort();
    for (const controller of expansionControllers) controller.abort();
    previewControllers.clear();
    expansionControllers.clear();
    const pending = enginePromise;
    enginePromise = undefined;
    if (pending) await (await pending).dispose();
  });

  pi.on("session_start", async (_event, ctx) => {
    const editPreviews = shouldUseEditPreviews(ctx);
    const session: SessionState = { cwd: ctx.cwd, editPreviews };
    activeSession = session;
    // Await initialization so the first visible diff uses warmed grammars and the configured theme.
    if (dependencies.engine || !dependencies.run || !dependencies.runEdit) {
      await (await getEngine()).prewarm();
    }
    if (activeSession !== session || !editPreviews) return;
    const { createDiffEditTool } = await loadEditPreview();
    if (activeSession !== session) return;
    pi.registerTool(createDiffEditTool(ctx.cwd, runEdit, previewControllers));
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const session = activeSession;
    if (session === undefined || !session.editPreviews || session.cwd !== ctx.cwd) return;
    await registerHashlineDiffTools(session);
  });

  pi.registerEntryRenderer<DiffDetails>(ENTRY_TYPE, (entry, { expanded }, theme) => {
    const details = entry.data;
    return details === undefined
      ? new Text(theme.fg("warning", "Diff data is unavailable."), 0, 0)
      : diffComponent(details, expanded, theme);
  });

  pi.registerTool(
    defineTool<typeof GitDiffParameters, DiffDetails, GitDiffRenderState>({
      ...INACTIVE_SPECIALIST_TOOL,
      ...PROGRAMMATIC_READ_ONLY,
      name: "git_diff",
      label: "Git diff",
      description:
        "Render a read-only syntax-highlighted Git diff with Shiki. Supports unstaged or staged changes, one revision/range, and optional pathspecs. Untracked files are excluded. Output is truncated to 2000 lines or 50KB; full truncated output is saved to a temporary file.",
      promptSnippet: "Render syntax-highlighted Git diffs with Diff",
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

  pi.registerCommand("diff", {
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
        ctx.ui.notify("/diff requires interactive mode.", "error");
        return;
      }

      try {
        const { runDiffCommand } = await loadCommand();
        await runDiffCommand(ctx, run, (details) => {
          pi.appendEntry<DiffDetails>(ENTRY_TYPE, details);
        });
      } catch (error) {
        ctx.ui.notify(diagnostic(error instanceof Error ? error.message : String(error)), "error");
      }
    },
  });
}

function commandHelp(): string {
  return [
    "Usage: /diff",
    "",
    "Show unstaged working-tree changes with syntax highlighting.",
    "Ask the agent to use `git_diff` for staged changes, revisions, or path filters.",
    "Set `diffRendering.editPreviews` to true in ~/.pi/agent/settings.json to enable syntax-highlighted edit previews.",
  ].join("\n");
}

export async function runGitDiff(
  executeGit: import("./shared").GitDiffExecutor,
  request: GitDiffRequest,
  cwd: string,
  options: RunOptions,
): Promise<DiffResult> {
  const { runGitDiff: run } = await import("./execution");
  return run(executeGit, request, cwd, options);
}

export async function runEditDiff(
  request: EditDiffRequest,
  cwd: string,
  options: RunOptions,
): Promise<DiffDetails> {
  const { runEditDiff: run } = await import("./execution");
  return run(request, cwd, options);
}

export default function diffRenderingExtension(
  pi: ExtensionAPI & Parameters<typeof registerHashlineRendering>[0],
): void {
  registerHashlineRendering(pi);
  registerDiffRenderingExtension(pi);
}
