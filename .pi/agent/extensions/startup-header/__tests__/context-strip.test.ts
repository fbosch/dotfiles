import { describe, expect, test } from "bun:test";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  type ContextStripConfig,
  loadContextViewConfig,
  renderInitialContextStrip,
} from "../context-strip";
import type { StartupContextEstimate } from "../runtime-types";

function estimate(overrides: Partial<StartupContextEstimate> = {}): StartupContextEstimate {
  return {
    contextWindowTokens: 200_000,
    autoCompactReserveTokens: 12_000,
    estimatedTokens: 160_000,
    categories: [
      { id: "system-prompt", tokens: 100_000 },
      { id: "system-tools", tokens: 60_000 },
    ],
    ...overrides,
  };
}

async function harness() {
  const colors: ThemeColor[] = [];
  const theme = {
    fg: (color: ThemeColor, text: string) => {
      colors.push(color);
      return text;
    },
  } as Theme;
  const loaded = await loadContextViewConfig();
  if (loaded === undefined) throw new Error("pi-context-view is unavailable");
  const config: ContextStripConfig = {
    ...loaded,
    categoryColors: new Map([
      ["system-prompt", "error"],
      ["system-tools", "warning"],
      ["auto-compact-buffer", "dim"],
      ["free-space", "muted"],
    ]),
  };
  return { colors, config, theme };
}

describe("initial context strip", () => {
  test("uses pi-context-view allocation, colors, glyphs, reserve, and free semantics", async () => {
    const { colors, config, theme } = await harness();
    const rendered = renderInitialContextStrip(theme, estimate(), config);
    const cells = rendered.split(" ")[1] ?? "";

    expect([...cells]).toHaveLength(14);
    expect(cells).toContain("■");
    expect(cells).toContain("◧");
    expect(cells).toContain("⛝");
    expect(cells).toContain("⛶");
    expect(rendered).toEndWith("160k/200k · reserve 12k");
    expect(colors).toContain("error");
    expect(colors).toContain("warning");
    expect(colors).toContain("dim");
    expect(colors).toContain("muted");
  });

  test("clamps over-capacity estimates without exposing source content", async () => {
    const { config, theme } = await harness();
    const rendered = renderInitialContextStrip(
      theme,
      estimate({
        estimatedTokens: 240_000,
        categories: [{ id: "context-files", tokens: 240_000 }],
      }),
      config,
    );

    expect([...((rendered.split(" ")[1] as string) ?? "")]).toHaveLength(14);
    expect(
      renderInitialContextStrip(
        theme,
        estimate({
          estimatedTokens: 80_000,
          categories: [{ id: "compacted-data", tokens: 80_000 }],
        }),
        config,
      ),
    ).toContain("▦");
    expect(rendered).toContain("240k/200k");
    expect(rendered).not.toMatch(/prompt text|tool schema|file content|skill content/i);
  });
});
