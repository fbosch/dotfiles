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
    estimatedTokens: 12_000,
    categories: [
      { id: "system-prompt", tokens: 6_000 },
      { id: "system-tools", tokens: 5_500 },
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
  test("renders the first slice of pi-context-view's full map with shared colors and glyphs", async () => {
    const { colors, config, theme } = await harness();
    const rendered = renderInitialContextStrip(theme, estimate(), config);
    const cells = rendered.match(/[■◧▦⛝⛶]/g) ?? [];

    expect(cells).toHaveLength(14);
    expect(cells).toContain("■");
    expect(cells).toContain("◧");
    expect(cells).toContain("⛶");
    expect(cells).not.toContain("⛝");
    expect(rendered).toEndWith("12k / 200k (6%)");
    expect(colors).toContain("error");
    expect(colors).toContain("warning");
    expect(colors).toContain("muted");
  });

  test("allocates the full context map before selecting its first row", async () => {
    const { config, theme } = await harness();
    let dimensions: readonly [number | undefined, number | undefined] | undefined;
    const observedConfig: ContextStripConfig = {
      ...config,
      buildUsageMap: (usage, columns, rows) => {
        dimensions = [columns, rows];
        return config.buildUsageMap(usage, columns, rows);
      },
    };

    renderInitialContextStrip(theme, estimate(), observedConfig);
    expect(dimensions).toEqual([14, 14]);
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

    expect(rendered.match(/[■◧▦⛝⛶]/g)).toHaveLength(14);
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
    expect(rendered).toContain("240k / 200k");
    expect(rendered).not.toMatch(/prompt text|tool schema|file content|skill content/i);
  });
});
