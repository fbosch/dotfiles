import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createDonutChartTool } from "../metadata";
import { chartDonutParameters, type DonutChartInput, donutChartVariant } from "../schemas";
import {
  donutChartRenderer,
  getDonutChartLayout,
  getDonutChartSummary,
  renderDonutChartSvg,
} from "../types/donut";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};

const input: DonutChartInput = {
  type: "donut",
  title: "Status",
  data: [
    { label: "Open", value: 3 },
    { label: "Closed", value: 1 },
  ],
};

const context = {
  mode: "tui",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;

test("donut chart validates pie-compatible data and persists its discriminator", () => {
  const { type: _type, ...parameters } = input;
  expect(Value.Check(chartDonutParameters, parameters)).toBe(true);
  expect(Value.Check(chartDonutParameters, input)).toBe(false);
  expect(Value.Check(donutChartVariant, input)).toBe(true);
  expect(
    donutChartRenderer.parseParameters({
      ...input,
      data: [
        { label: " Open ", value: 3 },
        { label: "Closed", value: 1 },
      ],
    }),
  ).toEqual({
    rows: [
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ],
    title: "Status",
  });
  expect(() =>
    donutChartRenderer.parseParameters({
      ...input,
      data: [
        { label: "Open", value: 0 },
        { label: "Closed", value: 0 },
      ],
    }),
  ).toThrow("finite positive total");
  expect(() =>
    donutChartRenderer.parseParameters({
      ...input,
      data: [
        { label: "Open", value: 1 },
        { label: " Open ", value: 2 },
      ],
    }),
  ).toThrow("duplicates");
});

test("donut chart renders a hole, legend percentages, accessible metadata and escaped text", () => {
  const rows = donutChartRenderer.parseParameters({
    ...input,
    title: "A & B <status>",
    data: [
      { label: "Open & ready", value: 3 },
      { label: "Closed", value: 1 },
    ],
  }).rows;
  const layout = getDonutChartLayout({ widthPx: 9, heightPx: 18 }, 60, rows.length);
  const svg = renderDonutChartSvg(rows, theme, layout, "A & B <status>", "Font & family");
  const paths = svg.match(/<path\b[^>]* d="[^"]+"[^>]*>/g) ?? [];

  expect(paths).toHaveLength(2);
  expect(paths[0]).not.toContain("L0,0Z");
  expect(paths[0]).toMatch(/L[^A]+A/);
  expect(svg).toContain("<title>A &amp; B &lt;status&gt;</title>");
  expect(svg).toContain('aria-label="Donut chart: A &amp; B &lt;status&gt;"');
  expect(svg).toContain(">Open &amp; ready 75.0%<");
  expect(svg).toContain(">Closed 25.0%<");
  expect(svg).toContain('font-family="Font &amp; family"');
  expect(svg).toContain('aria-description="Open &amp; ready: 3, Closed: 1"');
});

test("donut chart summaries and replay retain exact values and reject other chart types", () => {
  const details = donutChartRenderer.createDetails(donutChartRenderer.parseParameters(input), {
    imageWidthCells: 60,
    fontFamily: "sans-serif",
  });
  expect(details).toMatchObject({ type: "donut", rows: input.data, title: "Status" });
  expect(getDonutChartSummary(details)).toBe(
    "Status donut chart: Open 3 (75.0%); Closed 1 (25.0%)",
  );
  expect(donutChartRenderer.deserializeDetails(details)).toEqual(details);
  expect(donutChartRenderer.deserializeDetails({ ...details, type: "pie" })).toBeUndefined();
  expect(donutChartRenderer.deserializeDetails({ ...details, type: undefined })).toMatchObject({
    type: "donut",
  });
  expect(donutChartRenderer.deserializeDetails({ ...details, rows: "invalid" })).toBeUndefined();
});

test("donut chart keeps bounded layout and executes through the public TUI and print tools", async () => {
  const bounded = donutChartRenderer.createDetails(
    donutChartRenderer.parseParameters({ ...input, maxHeightCells: 8 }),
    { imageWidthCells: 60, fontFamily: "sans-serif" },
  );
  expect(
    donutChartRenderer.getLayout(bounded, { widthPx: 9, heightPx: 18 }, 60).heightCells,
  ).toBeLessThanOrEqual(8);

  const tool = createDonutChartTool();
  const result = await (tool.execute as NonNullable<typeof tool.execute>).call(
    tool,
    "chart_donut",
    input.title === undefined ? { data: input.data } : { data: input.data, title: input.title },
    undefined,
    undefined,
    context,
  );
  const printResult = await (tool.execute as NonNullable<typeof tool.execute>).call(
    tool,
    "chart_donut",
    input.title === undefined ? { data: input.data } : { data: input.data, title: input.title },
    undefined,
    undefined,
    { ...context, mode: "print" },
  );
  expect(printResult.content[0]).toEqual({
    type: "text",
    text: "Status donut chart: Open 3 (75.0%); Closed 1 (25.0%)",
  });
  expect(printResult.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(result.content).toEqual([
    { type: "text", text: "Status donut chart: Open 3 (75.0%); Closed 1 (25.0%)" },
  ]);
  expect(result.details).toMatchObject({ type: "donut", rows: input.data });
});
