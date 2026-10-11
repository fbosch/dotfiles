import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendCommandPrefix, requestPiCommaBashPrefix } from "../pi-comma/integration";
import type { DirenvStartupPayload } from "../startup-header/owner-payloads";
import { installStartupOwnerPublisher, type StartupOwnerStatus } from "../startup-header/publisher";
import {
  applyDirenvEnvironment,
  findProjectDirectory,
  installDirenvProcessEnvironment,
  loadDirenvEnvironment,
} from "./direnv-environment";

class DirenvExportError extends Error {
  constructor(readonly stderr: string) {
    super("direnv export failed");
  }
}

function reportsDirenvExportFailure(stderr: string): boolean {
  return /\b(?:error|failed|failure|cannot|unable)\b|permission denied|no such file or directory/i.test(
    stderr,
  );
}

export default function direnvSessionEnvironment(pi: ExtensionAPI): void {
  let startupStatus: StartupOwnerStatus<DirenvStartupPayload> = { state: "unavailable" };
  let restoreProcessEnvironment: (() => void) | undefined;
  let loadGeneration = 0;
  const startupPublisher = installStartupOwnerPublisher(pi.events, "direnv", () => startupStatus);
  const publishStartupStatus = (status: StartupOwnerStatus<DirenvStartupPayload>) => {
    startupStatus = status;
    startupPublisher.publish(status);
  };
  const clearProcessEnvironment = () => {
    loadGeneration += 1;
    restoreProcessEnvironment?.();
    restoreProcessEnvironment = undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    clearProcessEnvironment();
    const generation = loadGeneration;
    publishStartupStatus({ state: "collecting" });
    const projectDirectory = findProjectDirectory(ctx.cwd);
    const result = await loadDirenvEnvironment(ctx.cwd, projectDirectory, async (cwd) => {
      const exported = await pi.exec("direnv", ["export", "json"], { cwd });
      if (exported.code !== 0 || reportsDirenvExportFailure(exported.stderr)) {
        throw new DirenvExportError(exported.stderr);
      }
      return exported.stdout;
    });
    if (generation !== loadGeneration) return;

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

    const settings = pi.getSettings();
    const commandPrefix = appendCommandPrefix(
      settings.shellCommandPrefix,
      requestPiCommaBashPrefix(pi),
    );
    const bashTool = createBashToolDefinition(ctx.cwd, {
      ...(commandPrefix === undefined ? {} : { commandPrefix }),
      ...(settings.shellPath === undefined ? {} : { shellPath: settings.shellPath }),
      spawnHook: (spawnContext) => ({
        ...spawnContext,
        env: applyDirenvEnvironment(spawnContext.env, result.environment),
      }),
    });

    pi.registerTool(bashTool);
    restoreProcessEnvironment = installDirenvProcessEnvironment(result.environment);
    publishStartupStatus({ state: "ready", observedAt: Date.now() });
  });

  pi.on("session_shutdown", () => {
    clearProcessEnvironment();
    startupPublisher.dispose();
  });
}
