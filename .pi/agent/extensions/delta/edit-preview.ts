import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile, writeFile } from "node:fs/promises";
import {
  createEditToolDefinition,
  type EditOperations,
  type EditToolDetails,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { renderEditDeltaResult, replaceEditPreview } from "./rendering";
import {
  type DeltaDetails,
  type DeltaEditRequest,
  type EditDiffRunner,
  FULL_CONTEXT_LINES,
} from "./shared";

type NativeEditDefinition = ReturnType<typeof createEditToolDefinition>;
type NativeEditRenderCall = NonNullable<NativeEditDefinition["renderCall"]>;
type NativeEditInput = Parameters<NonNullable<NativeEditDefinition["execute"]>>[1];
type NativeEditState = Parameters<NativeEditRenderCall>[2]["state"];

type DeltaEditDetails = EditToolDetails & {
  readonly delta?: DeltaDetails;
};

interface DeltaEditState {
  expandedPreview: DeltaDetails | null | undefined;
  expandedPreviewController: AbortController | undefined;
  expandedPreviewKey: string | undefined;
  expandedPreviewPending: boolean;
  preview: DeltaDetails | undefined;
  previewController: AbortController | undefined;
  previewKey: string | undefined;
  previewPending: boolean;
  previewRequest: DeltaEditRequest | undefined;
}

type DeltaEditRenderState = NativeEditState & DeltaEditState;
type DeltaEditToolDefinition = ToolDefinition<
  NativeEditDefinition["parameters"],
  DeltaEditDetails | undefined,
  DeltaEditRenderState
>;

function renderableEditInput(args: unknown): NativeEditInput | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : record.file_path;
  if (typeof path !== "string") return undefined;

  if (
    Array.isArray(record.edits) &&
    record.edits.every(
      (edit): edit is { oldText: string; newText: string } =>
        edit !== null &&
        typeof edit === "object" &&
        typeof (edit as Record<string, unknown>).oldText === "string" &&
        typeof (edit as Record<string, unknown>).newText === "string",
    )
  ) {
    return { path, edits: record.edits };
  }

  if (typeof record.oldText === "string" && typeof record.newText === "string") {
    return { path, edits: [{ oldText: record.oldText, newText: record.newText }] };
  }

  return undefined;
}

async function simulateEdit(
  cwd: string,
  input: NativeEditInput,
  signal: AbortSignal,
): Promise<DeltaEditRequest> {
  let oldContent: Buffer | undefined;
  let newContent: string | undefined;
  const operations: EditOperations = {
    access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
    readFile: async (path) => {
      const content = await fsReadFile(path);
      oldContent = content;
      return content;
    },
    writeFile: async (_path, content) => {
      newContent = content;
    },
  };
  const previewTool = createEditToolDefinition(cwd, { operations });

  // The built-in edit executor currently ignores its context; renderCall has no ExtensionContext.
  // Keep this simulation delegated to Pi so matching and line-ending behavior stay identical.
  await previewTool.execute("delta-preview", input, signal, undefined, {
    cwd,
  } as ExtensionContext);
  if (oldContent === undefined || newContent === undefined) {
    throw new Error("Pi did not return enough data to render the edit preview");
  }

  return {
    newContent,
    oldContent: oldContent.toString("utf8"),
    path: input.path,
  };
}

function editDeltaState(state: NativeEditState): DeltaEditRenderState {
  return state as DeltaEditRenderState;
}

function renderExpandedEditPreview(
  details: DeltaDetails,
  request: DeltaEditRequest,
  cwd: string,
  state: DeltaEditState,
  runEdit: EditDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DeltaDetails {
  if (details.noChanges) return details;

  const expandedRequest = { ...request, context: FULL_CONTEXT_LINES };
  const requestKey = JSON.stringify(expandedRequest);
  if (state.expandedPreviewKey !== requestKey) {
    state.expandedPreviewController?.abort();
    if (state.expandedPreviewController !== undefined) {
      expansionControllers.delete(state.expandedPreviewController);
    }
    state.expandedPreviewController = undefined;
    state.expandedPreview = undefined;
    state.expandedPreviewKey = requestKey;
    state.expandedPreviewPending = false;
  }

  if (!state.expandedPreviewPending && state.expandedPreview === undefined) {
    const controller = new AbortController();
    state.expandedPreviewController = controller;
    state.expandedPreviewPending = true;
    expansionControllers.add(controller);
    void runEdit(expandedRequest, cwd, controller.signal).then(
      (expandedDetails) => {
        expansionControllers.delete(controller);
        if (
          state.expandedPreviewKey !== requestKey ||
          state.expandedPreviewController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedPreview = expandedDetails;
        state.expandedPreviewPending = false;
        state.expandedPreviewController = undefined;
        invalidate();
      },
      () => {
        expansionControllers.delete(controller);
        if (
          state.expandedPreviewKey !== requestKey ||
          state.expandedPreviewController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedPreview = null;
        state.expandedPreviewPending = false;
        state.expandedPreviewController = undefined;
        invalidate();
      },
    );
  }

  return state.expandedPreview ?? details;
}

export function createDeltaEditTool(
  cwd: string,
  runEdit: EditDiffRunner,
  previewControllers: Set<AbortController>,
): ToolDefinition<
  NativeEditDefinition["parameters"],
  DeltaEditDetails | undefined,
  DeltaEditRenderState
> {
  const nativeEdit = createEditToolDefinition(cwd);
  const nativeRenderCall = nativeEdit.renderCall;
  const nativeRenderResult = nativeEdit.renderResult;
  if (nativeRenderCall === undefined || nativeRenderResult === undefined) {
    throw new Error("Pi's built-in edit tool does not expose renderers");
  }

  const execute: DeltaEditToolDefinition["execute"] = async (
    toolCallId,
    input,
    signal,
    onUpdate,
    ctx,
  ) => {
    let oldContent: Buffer | undefined;
    let newContent: string | undefined;
    const operations: EditOperations = {
      access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
      readFile: async (path) => {
        const content = await fsReadFile(path);
        oldContent = content;
        return content;
      },
      writeFile: async (path, content) => {
        await writeFile(path, content, "utf8");
        newContent = content;
      },
    };
    const delegatedEdit = createEditToolDefinition(cwd, { operations });
    const result = await delegatedEdit.execute(toolCallId, input, signal, onUpdate, ctx);

    if (result.details !== undefined && oldContent !== undefined && newContent !== undefined) {
      try {
        const delta = await runEdit(
          {
            newContent,
            oldContent: oldContent.toString("utf8"),
            path: input.path,
          },
          cwd,
          signal,
        );
        return {
          ...result,
          details: { ...result.details, delta },
        };
      } catch {
        // Delta is presentation-only. Preserve the successful native edit result if it fails.
      }
    }

    return result;
  };

  const renderCall: NonNullable<
    ToolDefinition<
      NativeEditDefinition["parameters"],
      DeltaEditDetails | undefined,
      DeltaEditRenderState
    >["renderCall"]
  > = (args, theme, context) => {
    const state = editDeltaState(context.state);
    const input = renderableEditInput(args);
    const key = input === undefined ? undefined : JSON.stringify(input);
    if (state.previewKey !== key) {
      const previousController = state.previewController;
      previousController?.abort();
      if (previousController !== undefined) previewControllers.delete(previousController);
      state.previewController = undefined;
      state.preview = undefined;
      state.previewRequest = undefined;
      state.previewKey = key;
      state.previewPending = false;
      state.expandedPreviewController?.abort();
      if (state.expandedPreviewController !== undefined) {
        previewControllers.delete(state.expandedPreviewController);
      }
      state.expandedPreviewController = undefined;
      state.expandedPreview = undefined;
      state.expandedPreviewKey = undefined;
      state.expandedPreviewPending = false;
    }

    if (
      context.argsComplete &&
      input !== undefined &&
      !state.previewPending &&
      state.preview === undefined
    ) {
      const controller = new AbortController();
      const requestKey = key;
      state.previewController = controller;
      state.previewPending = true;
      previewControllers.add(controller);
      void simulateEdit(context.cwd, input, controller.signal)
        .then((request) =>
          runEdit(request, context.cwd, controller.signal).then((details) => ({
            details,
            request,
          })),
        )
        .then(
          ({ details, request }) => {
            previewControllers.delete(controller);
            if (
              state.previewKey !== requestKey ||
              controller.signal.aborted ||
              state.previewController !== controller
            ) {
              return;
            }
            state.preview = details;
            state.previewRequest = request;
            state.previewPending = false;
            state.previewController = undefined;
            context.invalidate();
          },
          () => {
            previewControllers.delete(controller);
            if (
              state.previewKey !== requestKey ||
              controller.signal.aborted ||
              state.previewController !== controller
            ) {
              return;
            }
            state.previewPending = false;
            state.previewController = undefined;
            context.invalidate();
          },
        );
    }

    const nativeComponent = nativeRenderCall(args, theme, context);
    const preview =
      context.expanded && state.preview !== undefined && state.previewRequest !== undefined
        ? renderExpandedEditPreview(
            state.preview,
            state.previewRequest,
            context.cwd,
            state,
            runEdit,
            previewControllers,
            context.invalidate,
          )
        : state.preview;
    return preview === undefined
      ? nativeComponent
      : replaceEditPreview(
          nativeComponent,
          preview,
          context.expanded,
          theme,
          context.expanded && state.expandedPreviewPending,
        );
  };

  const renderResult: NonNullable<
    ToolDefinition<
      NativeEditDefinition["parameters"],
      DeltaEditDetails | undefined,
      DeltaEditRenderState
    >["renderResult"]
  > = (result, options, theme, context) => {
    const delta = result.details?.delta;
    if (!context.isError && delta !== undefined) {
      const expandedDelta =
        options.expanded &&
        context.state.preview !== undefined &&
        context.state.previewRequest !== undefined
          ? renderExpandedEditPreview(
              context.state.preview,
              context.state.previewRequest,
              context.cwd,
              context.state,
              runEdit,
              previewControllers,
              context.invalidate,
            )
          : delta;
      if (context.state.preview?.output === delta.output) {
        const component =
          context.lastComponent instanceof Container ? context.lastComponent : new Container();
        component.clear();
        return component;
      }
      return renderEditDeltaResult(result, expandedDelta, options.expanded, theme);
    }
    return nativeRenderResult(result, options, theme, context);
  };

  return {
    ...nativeEdit,
    execute,
    renderCall,
    renderResult,
  };
}
