import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PiCommaExtensionModule = {
  default: (pi: ExtensionAPI) => void | Promise<void>;
};

type PiCommaExtensionImporter = () => Promise<PiCommaExtensionModule>;

export function supportsPiCommaPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux" || platform === "darwin";
}

export async function loadPiCommaExtension(
  pi: ExtensionAPI,
  platform: NodeJS.Platform = process.platform,
  importExtension: PiCommaExtensionImporter = () => import("./extension"),
): Promise<boolean> {
  if (!supportsPiCommaPlatform(platform)) return false;

  const extension = await importExtension();
  await extension.default(pi);
  return true;
}

export default async function piCommaExtension(pi: ExtensionAPI): Promise<void> {
  await loadPiCommaExtension(pi);
}
