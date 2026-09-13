import { beforeAll, describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Resvg } from "@resvg/resvg-js";
import { Value } from "typebox/value";
import { createTreeChartTool } from "../metadata";
import { chartTreeParameters } from "../schemas";
import {
  createTreeScene,
  type TreeChartInput,
  treeChartRenderer,
  treeChartVariant,
  validateTreeChartInput,
} from "../types/tree";
import manifest from "./fixtures/visual-validation/manifest.json";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};

const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;

const rows = [
  { id: "repo", label: "Repository" },
  { id: "src", parentId: "repo", label: "src" },
  { id: "tests", parentId: "repo", label: "tests" },
  { id: "parser", parentId: "src", label: "parser.ts" },
];

const input: TreeChartInput = {
  type: "tree",
  title: "Repository",
  data: rows,
};

describe("tree chart", () => {
  test("validates and normalizes one connected hierarchy", () => {
    expect(validateTreeChartInput(input)).toEqual({
      title: "Repository",
      data: [
        { id: "repo", parentId: null, label: "Repository" },
        { id: "src", parentId: "repo", label: "src" },
        { id: "tests", parentId: "repo", label: "tests" },
        { id: "parser", parentId: "src", label: "parser.ts" },
      ],
    });
    expect(Value.Check(chartTreeParameters, { data: rows })).toBe(true);
    expect(Value.Check(chartTreeParameters, { data: rows, type: "tree" })).toBe(false);
    expect(Value.Check(treeChartVariant, input)).toBe(true);
  });

  test("executes through the public tool and returns exact TUI text", async () => {
    const { type: _type, ...parameters } = input;
    const result = await createTreeChartTool().execute(
      "tree",
      parameters,
      undefined,
      undefined,
      context("tui"),
    );
    expect(result.content.map((part) => part.type)).toEqual(["text"]);
    expect(result.details).toMatchObject(validateTreeChartInput(input));
    await expect(
      createTreeChartTool().execute(
        "invalid",
        { ...parameters, type: "tree" } as never,
        undefined,
        undefined,
        context("tui"),
      ),
    ).rejects.toThrow("invalid tree chart parameters");
  });

  test("rejects duplicate IDs, missing parents, multiple roots, and cycles", () => {
    expect(() =>
      validateTreeChartInput({
        type: "tree",
        data: [
          { id: "root", label: "Root" },
          { id: " root ", parentId: "root", label: "Duplicate" },
        ],
      }),
    ).toThrow("node IDs must be unique");
    expect(() =>
      validateTreeChartInput({
        type: "tree",
        data: [
          { id: "root", label: "Root" },
          { id: "child", parentId: "missing", label: "Child" },
        ],
      }),
    ).toThrow("does not reference a node");
    expect(() =>
      validateTreeChartInput({
        type: "tree",
        data: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      }),
    ).toThrow("exactly one root");
    expect(() =>
      validateTreeChartInput({
        type: "tree",
        data: [
          { id: "root", label: "Root" },
          { id: "a", parentId: "b", label: "A" },
          { id: "b", parentId: "a", label: "B" },
        ],
      }),
    ).toThrow("acyclic");
  });

  test("renders ordered links, nodes, labels, and an accessible description", () => {
    const data = treeChartRenderer.parseParameters(input);
    const details = treeChartRenderer.createDetails(data, {
      imageWidthCells: 60,
      fontFamily: "sans-serif",
    });
    const layout = treeChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = treeChartRenderer.renderSvg(details, theme, layout);

    expect(svg).toContain('aria-label="Tree chart: Repository"');
    expect(svg).toContain("Repository [repo root]");
    expect(svg).toContain("parser.ts");
    expect(svg.match(/<line /g)?.length).toBe(3);
    expect(svg.match(/<circle /g)?.length).toBe(4);
    const firstLineX = Number(svg.match(/<line[^>]*x1="([^"]+)"/)?.[1]);
    const firstNodeX = Number(svg.match(/<circle[^>]*cx="([^"]+)"/)?.[1]);
    expect(firstLineX).toBeGreaterThan(firstNodeX + 4);
    expect(svg.match(/<text /g)?.length).toBe(5);
    expect(layout.plotWidthPx).toBeGreaterThan(0);
  });
  test("spaces labels in a compact broad hierarchy without overlap", () => {
    const details = treeChartRenderer.createDetails(
      treeChartRenderer.parseParameters({
        type: "tree",
        maxHeightCells: 8,
        data: [
          { id: "root", label: "Root" },
          ...Array.from({ length: 40 }, (_, index) => ({
            id: `child-${index}`,
            parentId: "root",
            label: `Child ${index}`,
          })),
        ],
      }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = treeChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = treeChartRenderer.renderSvg(details, theme, layout);
    const childLabelY = Array.from(
      svg.matchAll(/<text\b[^>]*\by="([0-9.e+-]+)"[^>]*>Child/g),
      (match) => Number(match[1]),
    ).sort((left, right) => left - right);
    expect(childLabelY.length).toBeGreaterThan(0);
    for (let index = 1; index < childLabelY.length; index += 1) {
      const previous = childLabelY[index - 1];
      const current = childLabelY[index];
      if (previous === undefined || current === undefined) continue;
      expect(current - previous).toBeGreaterThanOrEqual(layout.fontSizePx);
    }
    expect(svg).toContain("child-0");
  });

  test("keeps escape-heavy maximum hierarchies below the raster payload limit", () => {
    const rootId = `${"&".repeat(119)}r`;
    const escapedRows = [
      { id: rootId, label: "&".repeat(40) },
      ...Array.from({ length: 63 }, (_, index) => ({
        id: `${"&".repeat(118)}${String(index + 1).padStart(2, "0")}`,
        parentId: rootId,
        label: "&".repeat(40),
      })),
    ];
    const details = treeChartRenderer.createDetails(
      treeChartRenderer.parseParameters({ type: "tree", data: escapedRows }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const svg = treeChartRenderer.renderSvg(
      details,
      theme,
      treeChartRenderer.getLayout(details, undefined, details.imageWidthCells),
    );
    expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
    expect(svg).toContain("accompanying text result");
    expect(treeChartRenderer.getSummary(details)).toContain(rootId);
  });

  test("round-trips replay details and rejects malformed structures", () => {
    const data = treeChartRenderer.parseParameters(input);
    const details = treeChartRenderer.createDetails(data, {
      imageWidthCells: 60,
      fontFamily: "sans-serif",
      fontSize: 16,
    });

    expect(treeChartRenderer.deserializeDetails(details)).toEqual(details);
    expect(
      treeChartRenderer.deserializeDetails({
        ...details,
        data: [
          { id: "one", parentId: null, label: "One" },
          { id: "two", parentId: null, label: "Two" },
        ],
      }),
    ).toBeUndefined();
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a fixture value");
  return value;
}

let outlinedLabels: Map<string, string>;

function getLabelOutlines(svg: string): Map<string, string> {
  const texts = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map((match) => match[0]);
  const opening = svg.slice(0, svg.indexOf(">") + 1);
  // Resolve the real fallback-font ink once; all masks then rasterize these same outlines without rescanning system fonts.
  const resolved = new Resvg(
    `${opening}${texts.map((text, index) => `<g id="label-${index}">${text}</g>`).join("")}</svg>`,
    {
      font: { fontFiles: [], loadSystemFonts: true, defaultFontFamily: "sans-serif" },
    },
  ).toString();
  const outlines = new Map<string, string>();
  for (const match of resolved.matchAll(/<g id="label-(\d+)"[^>]*>/g)) {
    const start = match.index;
    let depth = 1;
    const remainder = resolved.slice(start + match[0].length);
    for (const tag of remainder.matchAll(/<g\b[^>]*>|<\/g>/g)) {
      depth += tag[0] === "</g>" ? -1 : 1;
      if (depth !== 0) continue;
      outlines.set(
        required(texts[Number(match[1])]),
        resolved.slice(start, start + match[0].length + tag.index + tag[0].length),
      );
      break;
    }
  }
  expect(outlines.size).toBe(texts.length);
  return outlines;
}

function rasterMask(svg: string, keep: (tag: string) => boolean): Uint8Array {
  const isolated = svg.replace(
    /<line\b[^>]*\/>|<circle\b[^>]*\/>|<text\b[^>]*>[\s\S]*?<\/text>/g,
    (tag) => (keep(tag) ? tag : ""),
  );
  const outlines = outlinedLabels;
  const outlined = isolated.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (tag) =>
    required(outlines.get(tag)),
  );
  return new Resvg(outlined, {
    font: { loadSystemFonts: false },
  }).render().pixels;
}

function overlappingInk(left: Uint8Array, right: Uint8Array): number {
  let count = 0;
  for (let offset = 3; offset < left.length; offset += 4) {
    if ((left[offset] ?? 0) >= 16 && (right[offset] ?? 0) >= 16) count += 1;
  }
  return count;
}

function trimConnectorEndpoints(svg: string): string {
  return svg.replace(/<line\b[^>]*\/>/g, (tag) => {
    const coordinate = (name: string) => Number(tag.match(new RegExp(`${name}="([^"]+)"`))?.[1]);
    const x1 = coordinate("x1");
    const y1 = coordinate("y1");
    const x2 = coordinate("x2");
    const y2 = coordinate("y2");
    const length = Math.hypot(x2 - x1, y2 - y1);
    const fraction = Math.min(0.75 / length, 0.5);
    return tag
      .replace(/x1="[^"]+"/, `x1="${x1 + (x2 - x1) * fraction}"`)
      .replace(/y1="[^"]+"/, `y1="${y1 + (y2 - y1) * fraction}"`)
      .replace(/x2="[^"]+"/, `x2="${x2 - (x2 - x1) * fraction}"`)
      .replace(/y2="[^"]+"/, `y2="${y2 - (y2 - y1) * fraction}"`);
  });
}

const frozenTree = required(manifest.charts.find((chart) => chart.chart === "tree"));
const renderedCases = frozenTree.cases.flatMap((fixture) =>
  (["D", "N", "N8"] as const).map((profileName) => {
    const profile = manifest.profiles[profileName];
    const parameters = {
      ...fixture.args,
      type: "tree",
      ...(profileName === "N8" ? { maxHeightCells: 8 } : {}),
    };
    const details = treeChartRenderer.createDetails(
      treeChartRenderer.parseParameters(parameters as TreeChartInput),
      { imageWidthCells: profile.widthCells, fontFamily: "sans-serif" },
    );
    const layout = treeChartRenderer.getLayout(
      details,
      { widthPx: profile.cellWidthPx, heightPx: profile.cellHeightPx },
      profile.widthCells,
    );
    const svg = treeChartRenderer.renderSvg(details, theme, layout);
    return { fixture, profileName, details, layout, svg };
  }),
);

beforeAll(() => {
  // Resolve fallback fonts once for the suite, not once per mask/profile.
  const texts = new Set(
    renderedCases.flatMap(({ svg }) =>
      [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map((match) => match[0]),
    ),
  );
  outlinedLabels = getLabelOutlines(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" font-family="sans-serif">${[...texts].join("")}</svg>`,
  );
}, 120_000);

for (const { fixture, profileName, details, layout, svg } of renderedCases) {
  test(`${fixture.id} ${profileName}: visible relationships and disjoint raster ink`, () => {
    const labels = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map((match) => match[0]);
    expect(svg.match(/<circle /g)).toHaveLength(details.data.length);
    expect(svg.match(/<line /g)).toHaveLength(details.data.length - 1);
    if (profileName === "N8") expect(layout.heightCells).toBeLessThanOrEqual(8);
    if (fixture.kind === "representative" && profileName !== "N8") {
      const identities = labels.flatMap((label) => label.replace(/<[^>]+>/g, "").split(" / "));
      for (const row of details.data) expect(identities, row.label).toContain(row.label);
    }
    const connectors = rasterMask(svg, (tag) => tag.startsWith("<line"));
    const connectorInteriors = rasterMask(trimConnectorEndpoints(svg), (tag) =>
      tag.startsWith("<line"),
    );
    const nodes = rasterMask(svg, (tag) => tag.startsWith("<circle"));
    const occupied = new Uint8Array(connectors.length);
    for (const label of labels) {
      const ink = rasterMask(svg, (tag) => tag === label);
      expect(
        ink.some((value, index) => index % 4 === 3 && value >= 16),
        label,
      ).toBe(true);
      // Only a subpixel connector tip may share antialiased ink with a label.
      expect(overlappingInk(ink, connectorInteriors), `connector interior through ${label}`).toBe(
        0,
      );
      expect(
        overlappingInk(ink, connectors),
        `connector endpoint through ${label}`,
      ).toBeLessThanOrEqual(4);
      expect(overlappingInk(ink, nodes), `node through ${label}`).toBe(0);
      expect(overlappingInk(ink, occupied), `label through ${label}`).toBe(0);
      for (let offset = 3; offset < ink.length; offset += 4) {
        occupied[offset] = Math.max(occupied[offset] ?? 0, ink[offset] ?? 0);
      }
    }
  });
}

test("pixel-space planning and rendering use the same domains and sibling order", () => {
  for (const { details, layout } of renderedCases) {
    const scene = createTreeScene(details, theme, layout);
    expect(scene.scales.x?.domain).toEqual([0, layout.plotWidthPx]);
    expect(scene.scales.y?.domain).toEqual([layout.plotHeightPx, 0]);
    const nodes = scene.points.filter((point) => point.markId.startsWith("dot"));
    for (const node of nodes) {
      expect(node.x).toBeCloseTo(Number(node.xValue), 8);
      expect(node.y).toBeCloseTo(Number(node.yValue), 8);
    }
    expect(required(nodes[1]).y).toBeLessThan(required(nodes[2]).y);
  }
});

test("narrow unary paths preserve source labels even without a matching title", () => {
  for (const title of [undefined, "Project layout"]) {
    const details = treeChartRenderer.createDetails(
      treeChartRenderer.parseParameters({
        type: "tree",
        data: rows,
        ...(title === undefined ? {} : { title }),
      }),
      { imageWidthCells: 28, fontFamily: "sans-serif" },
    );
    const layout = treeChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 28);
    const svg = treeChartRenderer.renderSvg(details, theme, layout);
    expect(svg).toContain(">src / parser.ts</text>");
    expect(svg).toContain(">Repository</text>");
    expect(svg).toContain(">tests</text>");
    expect(svg.match(/<circle /g)).toHaveLength(4);
    expect(svg.match(/<line /g)).toHaveLength(3);
  }
});
