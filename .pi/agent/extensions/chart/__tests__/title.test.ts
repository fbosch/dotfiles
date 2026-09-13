import { expect, test } from "bun:test";
import { getDonutChartLayout, getDonutChartSummary, renderDonutChartSvg } from "../types/donut";
import { getPieChartLayout, getPieChartSummary, renderPieChartSvg } from "../types/pie";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};

const cells = { widthPx: 9, heightPx: 18 };

type TitleCase = {
  chart: "pie" | "donut";
  title: string;
  rows: Array<{ label: string; value: number }>;
};

const cases: TitleCase[] = [
  {
    chart: "pie",
    title: "Status",
    rows: [
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ],
  },
  {
    chart: "pie",
    title: "File types",
    rows: [
      { label: "TypeScript (.ts)", value: 1 },
      { label: "Markdown (.md)", value: 1 },
      { label: "Lua (.lua)", value: 1 },
      { label: "JSON (.json)", value: 1 },
      { label: "Shell (.sh)", value: 1 },
      { label: "TSX (.tsx)", value: 1 },
      { label: "No extension", value: 1 },
      { label: "Fish (.fish)", value: 1 },
      { label: "YAML (.yml)", value: 1 },
      { label: "YAML (.yaml)", value: 1 },
      { label: "PNG (.png)", value: 0 },
      { label: "Other types", value: 2 },
    ],
  },
  {
    chart: "donut",
    title: "Status",
    rows: [
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ],
  },
  {
    chart: "donut",
    title: "File types",
    rows: [
      { label: "TypeScript (.ts)", value: 1 },
      { label: "Markdown (.md)", value: 1 },
      { label: "Lua (.lua)", value: 1 },
      { label: "JSON (.json)", value: 1 },
      { label: "Shell (.sh)", value: 1 },
      { label: "TSX (.tsx)", value: 1 },
      { label: "No extension", value: 1 },
      { label: "Fish (.fish)", value: 1 },
      { label: "YAML (.yml)", value: 1 },
      { label: "YAML (.yaml)", value: 1 },
      { label: "PNG (.png)", value: 0 },
      { label: "Other types", value: 2 },
    ],
  },
];

function titleGeometry(svg: string): { text: string; x: number; y: number; fontSize: number } {
  const match = /<text\b(?=[^>]*data-chart-title="true")[^>]*>([^<]*)<\/text>/.exec(svg);
  if (match === null) throw new Error("missing visible title");
  const x = /\bx="([0-9.]+)"/.exec(match[0]);
  const y = /\by="([0-9.]+)"/.exec(match[0]);
  const fontSize = /\bfont-size="([0-9.]+)"/.exec(match[0]);
  if (x === null || y === null || fontSize === null) {
    throw new Error("title geometry is incomplete");
  }
  return { text: match[1] ?? "", x: Number(x[1]), y: Number(y[1]), fontSize: Number(fontSize[1]) };
}

function viewport(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg);
  if (match === null) throw new Error("missing SVG viewport");
  return { width: Number(match[1]), height: Number(match[2]) };
}

test.each(cases)("$chart keeps the supplied title visible in the default viewport", (current) => {
  const untitledLayout =
    current.chart === "pie"
      ? getPieChartLayout(undefined, 60, current.rows.length)
      : getDonutChartLayout(undefined, 60, current.rows.length);
  const svg =
    current.chart === "pie"
      ? renderPieChartSvg(current.rows, theme, undefined, current.title)
      : renderDonutChartSvg(current.rows, theme, undefined, current.title);
  const geometry = titleGeometry(svg);
  const bounds = viewport(svg);

  expect(bounds.height).toBeGreaterThan(untitledLayout.heightPx);
  expect(geometry.text).toBe(current.title);
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.x + current.title.length * geometry.fontSize * 0.58).toBeLessThanOrEqual(
    bounds.width,
  );
  expect(geometry.y - geometry.fontSize).toBeGreaterThanOrEqual(0);
  expect(geometry.y).toBeLessThanOrEqual(bounds.height);
});

const maxTitle = "Maximum pie and donut chart title that remains exact in metadata 123456789012345";
if (maxTitle.length !== 80)
  throw new Error(`test title must be 80 characters, got ${maxTitle.length}`);

const profiles = [
  { name: "D", widthCells: 60, maxHeightCells: undefined },
  { name: "N", widthCells: 28, maxHeightCells: undefined },
  { name: "N8", widthCells: 28, maxHeightCells: 8 },
] as const;

const maxTitleCases = profiles.flatMap((profile) =>
  (["pie", "donut"] as const).map((chart) => ({ chart, profile })),
);

test.each(maxTitleCases)(
  "$chart fits an 80-character title at $profile.name",
  ({ chart, profile }) => {
    const rows = [
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ];
    const layout =
      chart === "pie"
        ? getPieChartLayout(
            cells,
            profile.widthCells,
            rows.length,
            undefined,
            profile.maxHeightCells,
            true,
          )
        : getDonutChartLayout(
            cells,
            profile.widthCells,
            rows.length,
            undefined,
            profile.maxHeightCells,
            true,
          );
    const svg =
      chart === "pie"
        ? renderPieChartSvg(rows, theme, layout, maxTitle)
        : renderDonutChartSvg(rows, theme, layout, maxTitle);
    const geometry = titleGeometry(svg);
    const bounds = viewport(svg);
    const escapedTitle = maxTitle
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const chartName = chart === "pie" ? "Pie" : "Donut";
    const summary =
      chart === "pie"
        ? getPieChartSummary({ rows, title: maxTitle, imageWidthCells: profile.widthCells })
        : getDonutChartSummary({ rows, title: maxTitle, imageWidthCells: profile.widthCells });

    expect(layout.widthPx).toBe(profile.widthCells * cells.widthPx);
    if (profile.name === "N8") expect(layout.heightCells).toBeLessThanOrEqual(8);
    expect(geometry.text).toEndWith("…");
    expect(geometry.text.length).toBeLessThan(maxTitle.length);
    expect(geometry.x + geometry.text.length * geometry.fontSize * 0.58).toBeLessThanOrEqual(
      bounds.width,
    );
    expect(svg).toContain(`<title>${escapedTitle}</title>`);
    expect(svg).toContain(`aria-label="${chartName} chart: ${escapedTitle}"`);
    expect(summary).toContain(maxTitle);
  },
);
