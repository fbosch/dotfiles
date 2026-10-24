import { tmpdir } from "node:os";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createOutputArtifacts } from "./artifacts";
import { outputEnabled } from "./policy";
import { createOutputSearchTool } from "./search";

function loadSettings(ctx: ExtensionContext): { global: unknown; project: unknown } {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  if (settings.drainErrors().length > 0) throw new Error("Invalid settings");
  return { global: settings.getGlobalSettings(), project: settings.getProjectSettings() };
}

interface Dependencies {
  settings: typeof loadSettings;
  artifactRoot: () => string;
}

export function registerToolOutput(
  pi: Pick<ExtensionAPI, "on" | "appendEntry" | "getAllTools" | "getActiveTools" | "registerTool">,
  dependencies: Dependencies = { settings: loadSettings, artifactRoot: tmpdir },
): void {
  const enabled = (ctx: ExtensionContext) => {
    const settings = dependencies.settings(ctx);
    return outputEnabled(settings.global, settings.project, ctx.isProjectTrusted());
  };
  const artifacts = createOutputArtifacts(pi, {
    enabled,
    artifactRoot: dependencies.artifactRoot,
  });
  pi.on("session_start", artifacts.resetSession);
  pi.on("session_shutdown", artifacts.resetSession);
  pi.registerTool(createOutputSearchTool(artifacts));
  pi.on("tool_result", artifacts.capture);
}

export default function toolOutput(pi: ExtensionAPI): void {
  registerToolOutput(pi);
}
