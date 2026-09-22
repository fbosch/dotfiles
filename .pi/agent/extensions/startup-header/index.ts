import { randomUUID } from "node:crypto";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { loadStartupHeaderArt, type StartupHeaderArt } from "./ascii-art";
import {
  discoverRepositoryFiles,
  inspectConfiguredCandidates,
  type RepositoryFiles,
} from "./candidate-adapter";
import type { CandidateInspection } from "./candidates";
import { readContextUsageFromContext, type StartupContextUsage } from "./context-usage";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  StartupOwnerStore,
} from "./contracts";
import { readHeaderOwnerSnapshot } from "./header-snapshot";
import { type JevStartupStatus, resolveJevStartupStatus } from "./jev-status";
import { captureStartupBaseline, deferStartupMeasurement } from "./startup-time";
import { renderStartupHeader } from "./view-model";
import { inspectWorkspace, type WorkspaceIdentity } from "./workspace";

export interface StartupHeaderDependencies {
  readonly inspectWorkspace: typeof inspectWorkspace;
  readonly inspectCandidates: typeof inspectConfiguredCandidates;
  readonly inspectRepositoryFiles?: (cwd: string) => Promise<RepositoryFiles>;
  readonly loadArt?: typeof loadStartupHeaderArt;
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
  let refreshContextUsage: ((context: ExtensionContext) => void) | undefined;

  pi.on("agent_start", (_event, ctx) => refreshContextUsage?.(ctx));
  pi.on("agent_end", (_event, ctx) => refreshContextUsage?.(ctx));
  pi.on("model_select", (_event, ctx) => refreshContextUsage?.(ctx));
  pi.on("session_compact", (_event, ctx) => refreshContextUsage?.(ctx));
  pi.on("session_compact_failed", (_event, ctx) => refreshContextUsage?.(ctx));

  pi.on("session_start", (event, ctx) => {
    disposeSession();
    disposeSession = () => {};
    if (ctx.mode !== "tui") return;

    let contextUsage: StartupContextUsage | undefined = readContextUsageFromContext(ctx);
    const sessionId = ctx.sessionManager.getSessionId();
    const generationId = randomUUID();
    const owners = new StartupOwnerStore(sessionId, generationId, readHeaderOwnerSnapshot);
    let active = true;
    let workspace: WorkspaceIdentity | undefined;
    let candidates: CandidateInspection | undefined;
    let art: StartupHeaderArt | undefined;
    let jev: JevStartupStatus | undefined;
    if (
      typeof ctx.cwd === "string" &&
      typeof ctx.isProjectTrusted === "function" &&
      ctx.modelRegistry !== undefined
    ) {
      try {
        const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
          projectTrusted: ctx.isProjectTrusted(),
        });
        jev = resolveJevStartupStatus(
          settings.getGlobalSettings(),
          settings.getProjectSettings(),
          ctx.modelRegistry,
        );
      } catch {
        jev = { state: "unavailable" };
      }
    }
    let requestRender = () => {};
    const updateContextUsage = (nextContext: ExtensionContext) => {
      contextUsage = readContextUsageFromContext(nextContext);
      requestRender();
    };
    refreshContextUsage = updateContextUsage;
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
      return {
        render: (width) =>
          renderStartupHeader(
            theme,
            width,
            contextUsage,
            startupElapsedMs,
            workspace,
            owners.get("updates"),
            {
              neovim: owners.get("neovim"),
              direnv: owners.get("direnv"),
              lsp: owners.get("lsp"),
              jev,
            },
            candidates,
            owners.get("auth"),
            undefined,
            owners.get("context"),
            art,
          ),
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
      cancelStartupMeasurement();
      unsubscribeOwners();
      owners.dispose();
      if (refreshContextUsage === updateContextUsage) refreshContextUsage = undefined;
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
