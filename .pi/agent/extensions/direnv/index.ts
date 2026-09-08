import {
  createBashTool,
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { appendCommandPrefix, requestPiCommaBashPrefix } from "../pi-comma/integration";
import type { DirenvStartupPayload } from "../startup-header/owner-payloads";
import { installStartupOwnerPublisher, type StartupOwnerStatus } from "../startup-header/publisher";
import {
  applyDirenvEnvironment,
  findProjectDirectory,
  loadDirenvEnvironment,
} from "./direnv-environment";

class DirenvExportError extends Error {
  constructor(readonly stderr: string) {
    super("direnv export failed");
  }
}

export default function direnvSessionEnvironment(pi: ExtensionAPI): void {
  const configuredDirectories = new Set<string>();
  let startupStatus: StartupOwnerStatus<DirenvStartupPayload> = { state: "unavailable" };
  const startupPublisher =
    typeof pi.events?.on === "function"
      ? installStartupOwnerPublisher(pi.events, "direnv", () => startupStatus)
      : undefined;
  const publishStartupStatus = (status: StartupOwnerStatus<DirenvStartupPayload>) => {
    startupStatus = status;
    startupPublisher?.publish(status);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (configuredDirectories.has(ctx.cwd)) return;
    configuredDirectories.add(ctx.cwd);

    publishStartupStatus({ state: "collecting" });
    const projectDirectory = findProjectDirectory(ctx.cwd);
    const result = await loadDirenvEnvironment(ctx.cwd, projectDirectory, async (cwd) => {
      const exported = await pi.exec("direnv", ["export", "json"], { cwd });
      if (exported.code !== 0) throw new DirenvExportError(exported.stderr);
      return exported.stdout;
    });

    if (result.status === "blocked") {
      publishStartupStatus({
        state: "degraded",
        observedAt: Date.now(),
        payload: { problem: "blocked" },
      });
      ctx.ui.notify("direnv: .envrc is blocked. Run `direnv allow` to enable it.", "warning");
      return;
    }
    if (result.status !== "loaded") {
      publishStartupStatus({
        state: "unavailable",
        observedAt: Date.now(),
        payload: { problem: result.status === "missing" ? "missing" : "load-failed" },
      });
      return;
    }

    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const commandPrefix = appendCommandPrefix(
      settings.getShellCommandPrefix(),
      requestPiCommaBashPrefix(pi),
    );
    const shellPath = settings.getShellPath();
    const bashTool = createBashTool(ctx.cwd, {
      ...(commandPrefix === undefined ? {} : { commandPrefix }),
      ...(shellPath === undefined ? {} : { shellPath }),
      spawnHook: (spawnContext) => ({
        ...spawnContext,
        env: applyDirenvEnvironment(spawnContext.env, result.environment),
      }),
    });

    pi.registerTool({
      ...bashTool,
      execute: (id, params, signal, onUpdate) => bashTool.execute(id, params, signal, onUpdate),
    });
    // Only this successful load path applies the environment to the owned Bash tool.
    publishStartupStatus({ state: "ready", observedAt: Date.now() });
  });

  pi.on("session_shutdown", () => {
    startupPublisher?.dispose();
  });
}
