/** Display identity for model providers, matching the WezTerm status bar. */
export type ProviderBrand = {
  /** Nerd Font private-use glyph. */
  readonly icon: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
};

export const PROVIDER_BRANDS: Readonly<Record<string, ProviderBrand>> = {
  "openai-codex": { icon: "\uec81", name: "Codex", rgb: [0x74, 0xaa, 0x9c] }, // ChatGPT green
  anthropic: { icon: "\uec82", name: "Claude", rgb: [0xb7, 0x7e, 0x64] }, // theme orange
};

export function providerBrand(providerId: string): ProviderBrand | undefined {
  return PROVIDER_BRANDS[providerId];
}

/** Brand colors are not theme keys, so they are emitted as truecolor escapes. */
export function brandColor(rgb: ProviderBrand["rgb"], text: string): string {
  return `\x1b[38;2;${rgb.join(";")}m${text}\x1b[39m`;
}
