import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NeovimExtensionDependencies } from "./extension";

export function createNeovimExtension(dependencies: NeovimExtensionDependencies = {}) {
  const socketPath = dependencies.socketPath ?? process.env.PI_NVIM_SOCKET;
  const launchId = dependencies.launchId ?? process.env.PI_NVIM_LAUNCH_ID;

  return async function neovimExtension(pi: ExtensionAPI): Promise<void> {
    if (socketPath === undefined || socketPath === "") return;

    // Keep the bridge and Effect off standalone startup, but finish registration before session_start.
    const { initializeNeovim } = await import("./extension");
    initializeNeovim(pi, {
      ...dependencies,
      socketPath,
      ...(launchId === undefined ? {} : { launchId }),
    });
  };
}

export default createNeovimExtension();
