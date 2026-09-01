import {
  createBashTool,
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
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

  pi.on("session_start", async (_event, ctx) => {
    if (configuredDirectories.has(ctx.cwd)) return;
    configuredDirectories.add(ctx.cwd);

    const projectDirectory = findProjectDirectory(ctx.cwd);
    const result = await loadDirenvEnvironment(ctx.cwd, projectDirectory, async (cwd) => {
      const exported = await pi.exec("direnv", ["export", "json"], { cwd });
      if (exported.code !== 0) throw new DirenvExportError(exported.stderr);
      return exported.stdout;
    });

    if (result.status === "blocked") {
      ctx.ui.notify("direnv: .envrc is blocked. Run `direnv allow` to enable it.", "warning");
      return;
    }
    if (result.status !== "loaded") return;

    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const commandPrefix = settings.getShellCommandPrefix();
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
  });
}
