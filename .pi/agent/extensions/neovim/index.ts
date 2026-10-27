import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NeovimExtensionDependencies } from "./extension";

export function createNeovimExtension(dependencies: NeovimExtensionDependencies = {}) {
  const socketPath = dependencies.socketPath ?? process.env.PI_NVIM_SOCKET;
  const launchId = dependencies.launchId ?? process.env.PI_NVIM_LAUNCH_ID;

  return async function neovimExtension(pi: ExtensionAPI): Promise<void> {
    if (socketPath === undefined || socketPath === "") return;
    if (launchId === undefined || !/^[a-f0-9]{32}$/.test(launchId))
      throw new Error("Pi Ask requires a valid launch ID");

    // Standalone Pi does not need the editor transport.
    const { initializeNeovim } = await import("./extension");
    initializeNeovim(pi, {
      ...dependencies,
      socketPath,
      launchId,
    });
  };
}

export default createNeovimExtension();
