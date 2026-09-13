import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { Resvg } from "@resvg/resvg-js";
import { Value } from "typebox/value";
import chartExtension from "../index";
import { resolveChartSettings } from "../types";
import {
  type BarChartInput,
  type BarChartRow,
  barChartRenderer,
  barChartVariant,
  getBarChartLayout,
  renderBarChartSvg,
  validateBarChartInput,
} from "../types/bar";
import manifest from "./fixtures/visual-validation/manifest.json";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (color: string) => {
    const colors: Record<string, string> = {
      accent: "\u001b[38;2;102;165;173m",
      success: "\u001b[38;2;129;155;105m",
      warning: "\u001b[38;2;183;126;100m",
      error: "\u001b[38;2;222;110;124m",
      thinkingLow: "\u001b[38;2;96;153;192m",
      thinkingMedium: "\u001b[38;2;102;165;173m",
      thinkingHigh: "\u001b[38;2;178;121;167m",
      thinkingXhigh: "\u001b[38;2;183;126;100m",
      thinkingMax: "\u001b[38;2;222;110;124m",
      bashMode: "\u001b[38;2;129;155;105m",
      text: "\u001b[38;2;187;187;187m",
    };
    return colors[color] ?? colors.accent ?? "";
  },
} as unknown as Theme;

type ChartExecute = (
  toolCallId: string,
  params: BarChartInput,
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: unknown;
}>;

function registerTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  chartExtension({
    on: () => {},
    registerTool: (definition: ToolDefinition) => {
      if (definition.name === "chart_bar") tool = definition;
    },
  } as unknown as ExtensionAPI);
  if (tool === undefined) throw new Error("chart was not registered");
  return tool;
}

const tuiContext = {
  mode: "tui",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;

const printContext = { ...tuiContext, mode: "print" } as unknown as ExtensionContext;

function currentChartFontFamily(): string {
  const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
  return resolveChartSettings(settings.getGlobalSettings(), settings.getProjectSettings())
    .fontFamily;
}

type BarProfileName = "D" | "N" | "D18" | "N8";
type BarManifestProfile = {
  widthCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
};
type BarManifestCase = {
  id: string;
  args: {
    data: BarChartRow[];
    title?: string;
    valueFormat?: "number" | "percent";
  };
  profiles: BarProfileName[];
  heightCaps?: { profile: BarProfileName; maxHeightCells: number }[];
};
type BarManifest = { cases: BarManifestCase[] };

const barManifest = manifest.charts.find(
  (chart) => chart.chart === "bar",
) as unknown as BarManifest;
const barProfiles = manifest.profiles as unknown as Record<BarProfileName, BarManifestProfile>;

function rasterize(svg: string) {
  return new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  }).render();
}

function hasAlphaInBand(
  pixels: Uint8Array,
  width: number,
  height: number,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
): boolean {
  const left = Math.max(0, Math.floor(xStart));
  const right = Math.min(width, Math.ceil(xEnd));
  const top = Math.max(0, Math.floor(yStart));
  const bottom = Math.min(height, Math.ceil(yEnd));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) >= 16) return true;
    }
  }
  return false;
}

function removeRasterTextAndRules(svg: string): string {
  return svg
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "")
    .replace(/<line\b[^>]*\/>/g, "");
}

describe("bar chart", () => {
  const rows = [
    { label: "Loss", value: -4 },
    { label: "Neutral", value: 0 },
    { label: "Gain", value: 6 },
  ];

  test("validates finite signed values and preserves input order", () => {
    expect(validateBarChartInput({ type: "bar", data: rows })).toEqual(rows);
    expect(() =>
      validateBarChartInput({
        type: "bar",
        data: [
          { label: "Bad", value: Number.NaN },
          { label: "Neutral", value: 0 },
        ],
      }),
    ).toThrow("finite");
    expect(() =>
      validateBarChartInput({
        type: "bar",
        data: [
          { label: "Loss", value: -4 },
          { label: " Loss ", value: 3 },
        ],
      }),
    ).toThrow("duplicates");
    expect(Value.Check(barChartVariant, { type: "bar", data: rows })).toBe(true);
    expect(Value.Check(barChartVariant, { type: "bar", data: [{ label: "x", value: 1 }] })).toBe(
      false,
    );
  });

  test("renders ordered signed bars, a zero baseline, and readable labels and values", () => {
    const svg = renderBarChartSvg(rows, theme, undefined, "Balance");
    expect(svg).toContain('aria-label="Bar chart: Balance"');
    expect(svg).toContain("Loss: -4");
    expect(svg).toContain("Neutral: 0");
    expect(svg).toContain("Gain: 6");
    expect(svg.indexOf("Loss: -4")).toBeLessThan(svg.indexOf("Neutral: 0"));
    expect(svg.indexOf("Neutral: 0")).toBeLessThan(svg.indexOf("Gain: 6"));
    expect(svg).toContain('stroke-opacity="0.72"');
    const zeroBar = /<rect[^>]* x="([^"]+)"[^>]* width="0"/.exec(svg);
    const baseline = /<line x1="([^"]+)" x2="\1" y1="0"/.exec(svg);
    expect(zeroBar?.[1]).toBeDefined();
    expect(baseline?.[1]).toBeDefined();
    expect(Number(zeroBar?.[1])).toBeCloseTo(Number(baseline?.[1]), 1);
    expect(svg).toContain('data-bar-zero="Neutral"');
    expect(svg).toContain("rgb(102, 165, 173)");
    expect(svg).toContain("rgb(129, 155, 105)");
    expect(svg).not.toMatch(/<rect\b[^>]*width="100%"[^>]*height="100%"/);
  });

  test("sizes the label gutter from the visible label and value text", () => {
    const longRows = [
      { label: "long label content", value: -1234 },
      { label: "another long label", value: 5678 },
    ];
    const shortLayout = getBarChartLayout({ widthPx: 9, heightPx: 18 }, 60, rows);
    const longLayout = getBarChartLayout({ widthPx: 9, heightPx: 18 }, 60, longRows);
    const widthPx = 60 * 9;

    expect(shortLayout.labelWidthPx).toBeLessThan(Math.round(widthPx * 0.42));
    expect(longLayout.labelWidthPx).toBeGreaterThan(shortLayout.labelWidthPx);
    expect(longLayout.labelWidthPx).toBeLessThanOrEqual(Math.round(widthPx * 0.48));
    expect(shortLayout.plotWidthPx).toBeGreaterThan(longLayout.plotWidthPx);
  });

  test("escapes custom fonts and adapts raster dimensions to the available width", () => {
    const font = `A < B & C "quoted" '`;
    const svg = renderBarChartSvg(rows, theme, undefined, undefined, font);
    expect(svg).toContain('font-family="A &lt; B &amp; C &quot;quoted&quot; &apos;"');

    const wide = getBarChartLayout(undefined, 60, rows, true);
    const narrow = getBarChartLayout({ widthPx: 9, heightPx: 18 }, 28, rows, true);
    expect(wide).toMatchObject({ widthPx: 540, heightCells: 7 });
    expect(narrow).toMatchObject({ widthPx: 252, heightCells: 7 });
    expect(wide.plotWidthPx).toBeGreaterThan(narrow.plotWidthPx);

    const wideSvg = renderBarChartSvg(rows, theme, wide, "Balance");
    const narrowSvg = renderBarChartSvg(rows, theme, narrow, "Balance");
    expect(wideSvg).toContain('width="540" height="114" viewBox="0 0 540 114"');
    expect(narrowSvg).toContain('width="252" height="114" viewBox="0 0 252 114"');
  });

  test("keeps a capped dense chart aligned to one compact row pitch", () => {
    const denseRows = Array.from({ length: 12 }, (_, index) => ({
      label: `Row ${index}`,
      value: index === 2 || index === 9 ? 0 : index % 2 === 0 ? index + 1 : -(index + 1),
    }));
    const layout = getBarChartLayout({ widthPx: 9, heightPx: 18 }, 28, denseRows, true, 32, 8);
    const svg = renderBarChartSvg(denseRows, theme, layout, "Dense rows");

    expect(layout.heightCells).toBeLessThanOrEqual(8);
    expect(layout.labelFontSizePx).toBe(8);
    expect(layout.plotHeightPx / denseRows.length).toBe(layout.rowHeightPx);
    expect(layout.plotY + layout.plotHeightPx).toBeLessThanOrEqual(layout.heightPx);
    expect(svg.match(/data-bar-row="\d+"/g)).toHaveLength(denseRows.length);
    expect(svg.match(/data-bar-zero="[^"]+"/g)).toHaveLength(2);
    for (const row of denseRows) expect(svg).toContain(`${row.label}:`);
  });

  test("routes bar results through TUI replay details and non-TUI PNG output", async () => {
    const execute = registerTool().execute as ChartExecute;
    const params: BarChartInput = { type: "bar", data: rows, title: "Balance" };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart", params, undefined, undefined, tuiContext),
      execute("chart", params, undefined, undefined, printContext),
    ]);
    expect(tuiResult.content).toEqual([
      { type: "text", text: "Balance bar chart: Loss -4; Neutral 0; Gain 6" },
    ]);
    expect(tuiResult.details).toEqual(
      expect.objectContaining({
        type: "bar",
        rows,
        title: "Balance",
        imageWidthCells: 80,
        fontFamily: currentChartFontFamily(),
      }),
    );
    const details = barChartRenderer.deserializeDetails(tuiResult.details);
    if (details === undefined) throw new Error("bar result must include replay details");
    const layout = barChartRenderer.getLayout(details, undefined, details.imageWidthCells);
    const image = printResult.content.find((content) => content.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(getPngDimensions(image?.data ?? "")).toEqual({
      widthPx: layout.widthPx,
      heightPx: layout.heightPx,
    });
  });

  test("replays every bar manifest view as a complete raster", () => {
    for (const fixture of barManifest.cases) {
      const views = [
        ...fixture.profiles.map((profile) => ({ profile, maxHeightCells: undefined })),
        ...(fixture.heightCaps ?? []).map(({ profile, maxHeightCells }) => ({
          profile,
          maxHeightCells,
        })),
      ];
      for (const view of views) {
        const profile = barProfiles[view.profile];
        const input: BarChartInput = {
          type: "bar",
          ...fixture.args,
          ...(view.maxHeightCells === undefined ? {} : { maxHeightCells: view.maxHeightCells }),
        };
        const data = barChartRenderer.parseParameters(input);
        const details = barChartRenderer.createDetails(data, {
          imageWidthCells: profile.widthCells,
          fontFamily: "sans-serif",
        });
        const layout = barChartRenderer.getLayout(
          details,
          { widthPx: profile.cellWidthPx, heightPx: profile.cellHeightPx },
          profile.widthCells,
        );
        const svg = barChartRenderer.renderSvg(details, theme, layout);
        const raster = rasterize(svg);
        const marksOnly = rasterize(removeRasterTextAndRules(svg));

        expect(
          { widthPx: raster.width, heightPx: raster.height },
          `${fixture.id} ${view.profile}`,
        ).toEqual({ widthPx: layout.widthPx, heightPx: layout.heightPx });
        if (view.maxHeightCells !== undefined) {
          expect(layout.heightCells, `${fixture.id} ${view.profile}`).toBeLessThanOrEqual(
            view.maxHeightCells,
          );
        }
        expect(svg.match(/data-bar-row="\d+"/g), `${fixture.id} ${view.profile}`).toHaveLength(
          fixture.args.data.length,
        );
        expect([...svg.matchAll(/data-bar-zero="([^"]+)"/g)].map((match) => match[1])).toEqual(
          fixture.args.data.filter((row) => row.value === 0).map((row) => row.label),
        );

        for (let index = 0; index < fixture.args.data.length; index += 1) {
          const rowTop = layout.plotY + layout.rowHeightPx * index;
          const rowBottom = rowTop + layout.rowHeightPx;
          expect(
            hasAlphaInBand(
              marksOnly.pixels,
              marksOnly.width,
              marksOnly.height,
              layout.plotX - 1,
              layout.plotX + layout.plotWidthPx + 1,
              rowTop,
              rowBottom,
            ),
            `${fixture.id} ${view.profile}: row ${index} has no raster mark`,
          ).toBe(true);
        }

        const rowLabels = [
          ...svg.matchAll(
            /<text data-bar-row="(\d+)"[^>]* y="([0-9.e+-]+)"[^>]*font-size="([0-9.e+-]+)"/g,
          ),
        ];
        expect(rowLabels, `${fixture.id} ${view.profile}`).toHaveLength(fixture.args.data.length);
        for (const match of rowLabels) {
          const y = Number(match[2]);
          const font = Number(match[3]);
          expect(y - font, `${fixture.id} ${view.profile}: row ${match[1]} top`).toBeGreaterThan(0);
          expect(
            y + font * 0.3,
            `${fixture.id} ${view.profile}: row ${match[1]} bottom`,
          ).toBeLessThan(layout.heightPx);
        }
      }
    }
  }, 30_000);

  test("deserializes only persisted bar details", () => {
    expect(barChartRenderer.deserializeDetails({ type: "bar", rows, imageWidthCells: 60 })).toEqual(
      { type: "bar", rows, imageWidthCells: 60 },
    );
    expect(barChartRenderer.deserializeDetails({ rows, imageWidthCells: 60 })).toBeUndefined();
  });
});
