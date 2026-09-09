import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverRepositoryFiles,
  inspectConfiguredCandidates,
  type RepositoryFiles,
} from "./candidate-adapter";
import type { CandidateInspection } from "./candidates";
import { type ContextStripConfig, loadContextViewConfig } from "./context-strip";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  StartupOwnerStore,
} from "./contracts";
import { readHeaderOwnerSnapshot } from "./header-snapshot";
import { readStartupSnapshotAPI } from "./runtime-capability";
import { captureStartupBaseline, deferStartupMeasurement } from "./startup-time";
import { renderStartupHeader, StartupRuntimeStore } from "./view-model";
import { inspectWorkspace, type WorkspaceIdentity } from "./workspace";

export interface StartupHeaderDependencies {
  readonly inspectWorkspace: typeof inspectWorkspace;
  readonly inspectCandidates: typeof inspectConfiguredCandidates;
  readonly inspectRepositoryFiles?: (cwd: string) => Promise<RepositoryFiles>;
}

const DEFAULT_DEPENDENCIES: StartupHeaderDependencies = {
  inspectWorkspace,
  inspectCandidates: inspectConfiguredCandidates,
  inspectRepositoryFiles: (cwd) => discoverRepositoryFiles(cwd, undefined),
};

export default function startupHeader(
  pi: ExtensionAPI,
  dependencies: StartupHeaderDependencies = DEFAULT_DEPENDENCIES,
): void {
  let disposeSession = () => {};
  const startupBaselines = new Map<string, string | undefined>();
  let contextViewConfigPromise: Promise<ContextStripConfig | undefined> | undefined;

  pi.on("before_model_availability", (_event, ctx) => {
    startupBaselines.set(
      ctx.sessionManager.getSessionId(),
      captureStartupBaseline(ctx.sessionManager.getEntries()),
    );
  });

  pi.on("session_start", (event, ctx) => {
    disposeSession();
    disposeSession = () => {};
    if (ctx.mode !== "tui") return;

    const runtime = new StartupRuntimeStore();
    const sessionId = ctx.sessionManager.getSessionId();
    const generationId = randomUUID();
    const owners = new StartupOwnerStore(sessionId, generationId, readHeaderOwnerSnapshot);
    let active = true;
    let workspace: WorkspaceIdentity | undefined;
    let candidates: CandidateInspection | undefined;
    let contextViewConfig: ContextStripConfig | undefined;
    let requestRender = () => {};
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
    let unsubscribeRuntime = () => {};
    const unsubscribeOwners = pi.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      if (owners.accept(value)) requestRender();
    });
    const capability = readStartupSnapshotAPI(pi.startupSnapshot);
    if (capability !== undefined) {
      try {
        unsubscribeRuntime = capability.subscribe((value) => {
          if (runtime.accept(value)) requestRender();
        });
        runtime.accept(capability.get());
      } catch {
        unsubscribeRuntime();
        unsubscribeRuntime = () => {};
        runtime.clear();
      }
    }

    // Wait until every extension module has loaded so pi-context-view's config module is already cached.
    contextViewConfigPromise ??= loadContextViewConfig();
    void contextViewConfigPromise.then((config) => {
      if (!active || config === undefined) return;
      contextViewConfig = config;
      requestRender();
    });
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
            runtime.get(),
            startupElapsedMs,
            workspace,
            owners.get("updates"),
            {
              neovim: owners.get("neovim"),
              direnv: owners.get("direnv"),
              lsp: owners.get("lsp"),
            },
            candidates,
            owners.get("auth"),
            contextViewConfig,
            owners.get("context"),
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
      unsubscribeRuntime();
      runtime.clear();
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
