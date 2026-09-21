import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type HerdrExtensionModule = {
  default: (pi: ExtensionAPI) => void | Promise<void>;
};

type HerdrExtensionImporter = () => Promise<HerdrExtensionModule>;

export function supportsHerdrEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.HERDR_ENV === "1";
}

export async function loadHerdrExtension(
  pi: ExtensionAPI,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  importExtension: HerdrExtensionImporter = () => import("./extension"),
): Promise<boolean> {
  if (!supportsHerdrEnvironment(environment)) return false;

  const extension = await importExtension();
  await extension.default(pi);
  return true;
}

export default async function herdr(pi: ExtensionAPI): Promise<void> {
  await loadHerdrExtension(pi);
}
