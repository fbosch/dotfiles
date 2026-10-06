import { randomUUID } from "node:crypto";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { loadStartupHeaderArt, type StartupHeaderArt } from "./ascii-art";
import {
  discoverRepositoryFiles,
  inspectConfiguredCandidates,
  type RepositoryFiles,
} from "./candidate-adapter";
import type { CandidateInspection } from "./candidates";
import { type ClassifierStartupStatus, resolveClassifierStartupStatus } from "./classifier-status";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  StartupOwnerStore,
} from "./contracts";
import { readHeaderOwnerSnapshot } from "./header-snapshot";
import { captureStartupBaseline, deferStartupMeasurement } from "./startup-time";
import { type UpdateAllResult, updateAllAvailablePackages } from "./update-all";
import { readAvailableUpdates, type UpdateDetail } from "./updates";
import { renderStartupHeader, UPDATE_ALL_BUTTON_TEXT } from "./view-model";
import { inspectWorkspace, type WorkspaceIdentity } from "./workspace";

export interface StartupHeaderDependencies {
  readonly inspectWorkspace: typeof inspectWorkspace;
  readonly inspectCandidates: typeof inspectConfiguredCandidates;
  readonly inspectRepositoryFiles?: (cwd: string) => Promise<RepositoryFiles>;
  readonly loadArt?: typeof loadStartupHeaderArt;
  readonly updateAllPackages?: (
    context: ExtensionContext,
    updates: readonly UpdateDetail[],
  ) => Promise<UpdateAllResult>;
}

const DEFAULT_DEPENDENCIES: StartupHeaderDependencies = {
  inspectWorkspace,
  inspectCandidates: inspectConfiguredCandidates,
  inspectRepositoryFiles: (cwd) => discoverRepositoryFiles(cwd, undefined),
  loadArt: loadStartupHeaderArt,
};

export default function startupHeader(
  pi: ExtensionAPI,
  dependencies: StartupHeaderDependencies = DEFAULT_DEPENDENCIES,
): void {
  let disposeSession = () => {};
  const startupBaselines = new Map<string, string | undefined>();

  let runCurrentUpdateAll: (context: ExtensionCommandContext) => Promise<boolean> = async () =>
    false;

  pi.registerCommand("startup-header-update-all", {
    description: "Update all listed Pi packages and reload Pi",
    handler: async (_args, context) => {
      if (await runCurrentUpdateAll(context)) await context.reload();
    },
  });
  const requestUpdateAll = () =>
    pi.sendUserMessage("/startup-header-update-all", { expandPromptTemplates: true });

  pi.registerShortcut(Key.ctrlAlt("u"), {
    description: "Update all available Pi packages",
    handler: requestUpdateAll,
  });
  pi.on("session_start", (event, ctx) => {
    disposeSession();
    disposeSession = () => {};
    runCurrentUpdateAll = async () => false;
    if (ctx.mode !== "tui") return;

    const sessionId = ctx.sessionManager.getSessionId();
    const generationId = randomUUID();
    const owners = new StartupOwnerStore(sessionId, generationId, readHeaderOwnerSnapshot);
    let active = true;
    let workspace: WorkspaceIdentity | undefined;
    let candidates: CandidateInspection | undefined;
    let art: StartupHeaderArt | undefined;
    let classifier: ClassifierStartupStatus | undefined;
    if (
      typeof ctx.cwd === "string" &&
      typeof ctx.isProjectTrusted === "function" &&
      ctx.modelRegistry !== undefined
    ) {
      try {
        const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
          projectTrusted: ctx.isProjectTrusted(),
        });
        classifier = resolveClassifierStartupStatus(
          settings.getGlobalSettings(),
          settings.getProjectSettings(),
          ctx.modelRegistry,
        );
      } catch {
        classifier = { state: "unavailable" };
      }
    }
    let requestRender = () => {};
    let updateActionState: "ready" | "updating" | "reloading" = "ready";
    let updateInProgress = false;
    const updatePackages = dependencies.updateAllPackages ?? updateAllAvailablePackages;
    const runUpdateAll = async (actionContext: ExtensionCommandContext): Promise<boolean> => {
      if (!active || updateInProgress || updateActionState === "reloading") return false;
      const updates = readAvailableUpdates(owners.get("updates"), Date.now());
      if (updates === undefined) {
        actionContext.ui.notify("Update information is no longer current.", "warning");
        return false;
      }

      updateInProgress = true;
      updateActionState = "updating";
      requestRender();
      try {
        const result = await updatePackages(actionContext, updates);
        if (!active) return false;
        if (result.cancelled) {
          updateActionState = "ready";
          return false;
        }
        if (result.failed.length > 0) {
          if (result.updated > 0) {
            updateActionState = "reloading";
            actionContext.ui.notify(
              `Updated ${result.updated} of ${updates.length} packages; failed: ${result.failed.join(", ")}. Reloading Pi to activate the updates.`,
              "warning",
            );
            return true;
          }
          updateActionState = "ready";
          actionContext.ui.notify(`Could not update: ${result.failed.join(", ")}.`, "error");
          return false;
        }
        if (result.updated !== updates.length) {
          const shouldReload = result.updated > 0;
          updateActionState = shouldReload ? "reloading" : "ready";
          actionContext.ui.notify(
            shouldReload
              ? `Updated ${result.updated} of ${updates.length} packages. Reloading Pi to activate the updates.`
              : `Updated ${result.updated} of ${updates.length} packages.`,
            "warning",
          );
          return shouldReload;
        }

        updateActionState = "reloading";
        const countLabel = `${result.updated} package${result.updated === 1 ? "" : "s"}`;
        actionContext.ui.notify(
          `Updated ${countLabel}. Reloading Pi to activate the updates.`,
          "info",
        );
        return true;
      } catch (error) {
        if (!active) return false;
        updateActionState = "ready";
        actionContext.ui.notify(
          `Unable to update packages: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return false;
      } finally {
        updateInProgress = false;
        if (active) requestRender();
      }
    };
    runCurrentUpdateAll = runUpdateAll;
    let startupElapsedMs: number | undefined;
    const startupBaseline = startupBaselines.has(sessionId)
      ? startupBaselines.get(sessionId)
      : captureStartupBaseline(ctx.sessionManager.getEntries());
    startupBaselines.delete(sessionId);
    const cancelStartupMeasurement = deferStartupMeasurement(
      () => ctx.sessionManager.getEntries(),
      startupBaseline,
      event.reason,
      (measurement) => {
        startupElapsedMs = measurement.elapsedMs;
        requestRender();
      },
    );
    const unsubscribeOwners = pi.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      if (owners.accept(value)) requestRender();
    });

    const artLoader = dependencies.loadArt ?? loadStartupHeaderArt;
    try {
      art = artLoader(ctx);
    } catch (error) {
      ctx.ui.notify?.(
        `Could not load startup header art: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
    const workspacePromise = dependencies.inspectWorkspace(ctx.cwd);
    const repositoryFilesPromise = (
      dependencies.inspectRepositoryFiles ?? ((cwd) => discoverRepositoryFiles(cwd, undefined))
    )(ctx.cwd);
    void Promise.all([workspacePromise, repositoryFilesPromise])
      .then(async ([identity, repositoryFiles]) => {
        if (!active) return;
        workspace = identity;
        candidates = await dependencies.inspectCandidates(ctx, identity, repositoryFiles);
        if (active) requestRender();
      })
      .catch(() => {});

    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      let renderedLines: string[] = [];
      return {
        render: (width) => {
          renderedLines = renderStartupHeader(
            theme,
            width,
            startupElapsedMs,
            workspace,
            owners.get("updates"),
            {
              neovim: owners.get("neovim"),
              direnv: owners.get("direnv"),
              lsp: owners.get("lsp"),
              classifier,
            },
            candidates,
            owners.get("auth"),
            art,
            updateActionState,
          );
          return renderedLines;
        },
        handleMouse: (event) => {
          if (event.type !== "click" || event.button !== "left") return;
          const line = renderedLines[event.y];
          const buttonIndex = line?.indexOf(UPDATE_ALL_BUTTON_TEXT);
          if (line === undefined || buttonIndex === undefined || buttonIndex < 0) return;
          const buttonStart = visibleWidth(line.slice(0, buttonIndex));
          if (
            event.x < buttonStart ||
            event.x >= buttonStart + visibleWidth(UPDATE_ALL_BUTTON_TEXT)
          ) {
            return;
          }
          requestUpdateAll();
          return { handled: true };
        },
        invalidate() {},
      };
    });

    for (const ownerId of STARTUP_OWNER_IDS) {
      pi.events.emit(
        STARTUP_OWNER_REQUEST_EVENT,
        createStartupOwnerRequest(sessionId, generationId, ownerId),
      );
    }
    disposeSession = () => {
      active = false;
      runCurrentUpdateAll = async () => false;
      cancelStartupMeasurement();
      unsubscribeOwners();
      owners.dispose();
      requestRender = () => {};
    };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    startupBaselines.set(
      ctx.sessionManager.getSessionId(),
      captureStartupBaseline(ctx.sessionManager.getEntries()),
    );
    disposeSession();
    disposeSession = () => {};
  });
}
