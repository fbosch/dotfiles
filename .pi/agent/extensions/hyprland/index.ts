import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type HyprlandExtensionModule = {
  default: (pi: ExtensionAPI) => void | Promise<void>;
};

type HyprlandExtensionImporter = () => Promise<HyprlandExtensionModule>;

export function supportsHyprlandEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    environment.HYPRLAND_INSTANCE_SIGNATURE !== undefined &&
    environment.HYPRLAND_INSTANCE_SIGNATURE !== "" &&
    environment.XDG_RUNTIME_DIR !== undefined &&
    environment.XDG_RUNTIME_DIR !== "" &&
    environment.WAYLAND_DISPLAY !== undefined &&
    environment.WAYLAND_DISPLAY !== ""
  );
}

export async function loadHyprlandExtension(
  pi: ExtensionAPI,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  importExtension: HyprlandExtensionImporter = () => import("./extension"),
): Promise<boolean> {
  if (!supportsHyprlandEnvironment(environment)) return false;

  const extension = await importExtension();
  await extension.default(pi);
  return true;
}

export default async function hyprlandExtension(pi: ExtensionAPI): Promise<void> {
  await loadHyprlandExtension(pi);
}
