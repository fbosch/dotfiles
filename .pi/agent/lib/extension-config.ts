import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

export interface ExtensionConfigLayers {
  readonly global: unknown;
  readonly project: unknown;
}

export function globalExtensionConfigPath(name: string, agentDirectory = getAgentDir()): string {
  return join(agentDirectory, `${name}.json`);
}

function projectExtensionConfigPath(name: string, cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, `${name}.json`);
}

export function readJsonConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `Cannot load extension config from ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadExtensionConfigLayers(
  name: string,
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  agentDirectory = getAgentDir(),
): ExtensionConfigLayers {
  return {
    global: readJsonConfig(globalExtensionConfigPath(name, agentDirectory)),
    project: context.isProjectTrusted()
      ? readJsonConfig(projectExtensionConfigPath(name, context.cwd))
      : undefined,
  };
}
