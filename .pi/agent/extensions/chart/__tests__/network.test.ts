import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Resvg } from "@resvg/resvg-js";
import { Value } from "typebox/value";
import { createNetworkChartTool } from "../metadata";
import { chartNetworkParameters } from "../schemas";
import {
  type NetworkChartInput,
  networkChartRenderer,
  networkChartVariant,
  validateNetworkChartInput,
} from "../types/network";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};

const context = {
  mode: "tui",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;
const printContext = { ...context, mode: "print" } as unknown as ExtensionContext;

const input: NetworkChartInput = {
  type: "network",
  title: "Repository calls",
  nodes: [
    { id: " app ", label: "App", group: "frontend" },
    { id: "parser", label: "Parser", group: "backend" },
    { id: "shared", label: "Shared" },
    { id: "cycle", label: "Cycle" },
  ],
  edges: [
    { source: "app", target: "parser", label: "calls" },
    { source: "app", target: "shared", label: "uses" },
    { source: "parser", target: "shared" },
    { source: "cycle", target: "cycle", label: "recurses" },
  ],
};

const frozenWorkflowInputs = [
  {
    name: "full",
    input: {
      type: "network",
      nodes: [
        { id: "brief", label: "Parent brief" },
        { id: "select", label: "Select format" },
        { id: "build", label: "Build candidate" },
        { id: "render", label: "Render" },
        { id: "inspect", label: "Inspect" },
        { id: "fix", label: "Fix" },
        { id: "validated", label: "Validated" },
        { id: "blocked", label: "Blocked" },
        { id: "publish", label: "Parent publishes" },
      ],
      edges: [
        { source: "brief", target: "select" },
        { source: "select", target: "build" },
        { source: "build", target: "render" },
        { source: "render", target: "inspect" },
        { source: "inspect", target: "validated", label: "semantic + visual pass" },
        { source: "inspect", target: "fix", label: "defect + retries" },
        { source: "fix", target: "render" },
        { source: "inspect", target: "blocked", label: "unavailable/exhausted" },
        { source: "validated", target: "publish" },
      ],
    } satisfies NetworkChartInput,
  },
  {
    name: "short",
    input: {
      type: "network",
      nodes: [
        { id: "brief", label: "Brief" },
        { id: "select", label: "Select" },
        { id: "build", label: "Build" },
        { id: "render", label: "Render" },
        { id: "inspect", label: "Inspect" },
        { id: "fix", label: "Fix" },
        { id: "stop", label: "Stop" },
        { id: "pass", label: "Pass" },
        { id: "show", label: "Show" },
      ],
      edges: [
        { source: "brief", target: "select" },
        { source: "select", target: "build" },
        { source: "build", target: "render" },
        { source: "render", target: "inspect" },
        { source: "inspect", target: "stop" },
        { source: "inspect", target: "pass" },
        { source: "inspect", target: "fix" },
        { source: "fix", target: "render" },
        { source: "pass", target: "show" },
      ],
    } satisfies NetworkChartInput,
  },
] as const;

function renderFrozenWorkflow(input: NetworkChartInput, width = 60): string {
  const details = networkChartRenderer.createDetails(networkChartRenderer.parseParameters(input), {
    imageWidthCells: width,
    fontFamily: "sans-serif",
  });
  return networkChartRenderer.renderSvg(
    details,
    theme,
    networkChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, width),
  );
}

type CollisionCategory = "node-label" | "edge-label" | "nodes" | "strokes" | "arrowheads";
type Raster = { width: number; height: number; pixels: Uint8Array };

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

const collisionCategories: readonly CollisionCategory[] = [
  "node-label",
  "edge-label",
  "nodes",
  "strokes",
  "arrowheads",
];

const outlinedLabels = new Map<string, Map<string, string>>();

function getLabelOutlines(svg: string): Map<string, string> {
  const cached = outlinedLabels.get(svg);
  if (cached !== undefined) return cached;
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
    const labelIndex = match[1];
    const original = labelIndex === undefined ? undefined : texts[Number(labelIndex)];
    if (start === undefined || original === undefined) continue;
    let depth = 1;
    const remainder = resolved.slice(start + match[0].length);
    for (const tag of remainder.matchAll(/<g\b[^>]*>|<\/g>/g)) {
      depth += tag[0] === "</g>" ? -1 : 1;
      if (depth !== 0 || tag.index === undefined) continue;
      outlines.set(
        original,
        resolved.slice(start, start + match[0].length + tag.index + tag[0].length),
      );
      break;
    }
  }
  expect(outlines.size).toBe(texts.length);
  outlinedLabels.set(svg, outlines);
  return outlines;
}

function renderCollisionMask(
  svg: string,
  category: CollisionCategory,
  labelIndex?: number,
  useOutlines = true,
): Raster {
  let currentLabel = 0;
  const openingEnd = svg.indexOf(">") + 1;
  const opening = svg.slice(0, openingEnd);
  const closing = "</svg>";
  let body = svg.slice(openingEnd, -closing.length);
  const definitionsStart = body.indexOf("<defs>");
  const definitionsEnd = body.indexOf("</defs>");
  const definitions =
    definitionsStart >= 0 && definitionsEnd >= 0
      ? body.slice(definitionsStart, definitionsEnd + "</defs>".length)
      : "";
  if (definitions.length > 0) {
    body = body.slice(0, definitionsStart) + body.slice(definitionsEnd + "</defs>".length);
  }
  // Semantic masks must not inherit opaque label backplates that can conceal intersections.
  body = body.replace(/<rect\b[^>]*\/>/g, "");
  body = body.replace(
    /<line[^>]*\/>|<path[^>]*\/>|<circle[^>]*\/>|<text[^>]*>[\s\S]*?<\/text>/g,
    (tag) => {
      if (tag.startsWith("<line")) {
        if (category === "strokes") return tag.replace(/ marker-end="[^"]*"/g, "");
        if (category === "arrowheads")
          return tag.replace(/ stroke="[^"]*"/, ' stroke="transparent"');
        return "";
      }
      if (tag.startsWith("<path")) {
        if (category === "strokes") return tag.replace(/ marker-end="[^"]*"/g, "");
        if (category === "arrowheads" && tag.includes("marker-end")) {
          return tag.replace(/ stroke="[^"]*"/, ' stroke="transparent"');
        }
        return "";
      }
      if (tag.startsWith("<circle")) return category === "nodes" ? tag : "";
      const isNodeLabel = tag.includes('font-family="inherit"');
      const isEdgeLabel = !tag.includes("font-family=");
      if (
        (category === "node-label" && isNodeLabel) ||
        (category === "edge-label" && isEdgeLabel)
      ) {
        return labelIndex === undefined || currentLabel++ === labelIndex ? tag : "";
      }
      return "";
    },
  );
  if (useOutlines) {
    const outlines = getLabelOutlines(svg);
    body = body.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (text) =>
      required(outlines.get(text), `missing outline for ${text}`),
    );
  }
  const rendered = new Resvg(
    opening + (category === "arrowheads" ? definitions : "") + body + closing,
    { font: { loadSystemFonts: !useOutlines, defaultFontFamily: "sans-serif" } },
  ).render();
  return { width: rendered.width, height: rendered.height, pixels: rendered.pixels };
}

function collisionPixels(left: Raster, right: Raster) {
  let pixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const offset = (y * left.width + x) * 4;
      if ((left.pixels[offset + 3] ?? 0) < 16 || (right.pixels[offset + 3] ?? 0) < 16) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    pixels,
    bounds: pixels === 0 ? undefined : { minX, maxX, minY, maxY },
  };
}

describe("network chart", () => {
  test("validates and normalizes graph nodes and directed edges", () => {
    expect(validateNetworkChartInput(input)).toEqual({
      title: "Repository calls",
      nodes: [
        { id: "app", label: "App", group: "frontend" },
        { id: "parser", label: "Parser", group: "backend" },
        { id: "shared", label: "Shared" },
        { id: "cycle", label: "Cycle" },
      ],
      edges: [
        { source: "app", target: "parser", label: "calls" },
        { source: "app", target: "shared", label: "uses" },
        { source: "parser", target: "shared" },
        { source: "cycle", target: "cycle", label: "recurses" },
      ],
    });
    expect(Value.Check(chartNetworkParameters, { nodes: input.nodes, edges: input.edges })).toBe(
      true,
    );
    expect(Value.Check(chartNetworkParameters, input)).toBe(false);
    expect(Value.Check(networkChartVariant, input)).toBe(true);
  });

  test("validates and preserves the optional bounded height cap", () => {
    expect(
      Value.Check(chartNetworkParameters, {
        nodes: input.nodes,
        edges: input.edges,
        maxHeightCells: 32,
      }),
    ).toBe(true);
    expect(
      Value.Check(chartNetworkParameters, {
        nodes: input.nodes,
        edges: input.edges,
        maxHeightCells: 64,
      }),
    ).toBe(true);
    expect(validateNetworkChartInput({ ...input, maxHeightCells: 32 })).toMatchObject({
      maxHeightCells: 32,
    });
    expect(
      Value.Check(chartNetworkParameters, {
        nodes: input.nodes,
        edges: input.edges,
        maxHeightCells: 7,
      }),
    ).toBe(false);
    expect(
      Value.Check(chartNetworkParameters, {
        nodes: input.nodes,
        edges: input.edges,
        maxHeightCells: 65,
      }),
    ).toBe(false);
  });

  test("supports multiple parents, disconnected nodes, cycles, and self-loops", () => {
    expect(() => validateNetworkChartInput(input)).not.toThrow();
    expect(
      validateNetworkChartInput({
        type: "network",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "c", target: "b" },
          { source: "b", target: "a" },
        ],
      }),
    ).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
  });

  test("rejects duplicate IDs, missing endpoints, and duplicate directed edges", () => {
    expect(() =>
      validateNetworkChartInput({
        type: "network",
        nodes: [
          { id: "a", label: "A" },
          { id: " a ", label: "Duplicate" },
        ],
        edges: [],
      }),
    ).toThrow("node IDs must be unique");
    expect(() =>
      validateNetworkChartInput({
        type: "network",
        nodes: [{ id: "a", label: "A" }],
        edges: [{ source: "a", target: "missing" }],
      }),
    ).toThrow("does not reference a node");
    expect(() =>
      validateNetworkChartInput({
        type: "network",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "a", target: "b" },
        ],
      }),
    ).toThrow("directed edges must be unique");
  });

  test("renders nodes, directional links, edge labels, and an accessible exact summary", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters(input),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = networkChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = networkChartRenderer.renderSvg(details, theme, layout);

    expect(svg).toContain('aria-label="Network chart: Repository calls"');
    expect(svg).toContain("App [app group=frontend]");
    expect(svg).not.toContain('fill="color"');
    expect(svg).toContain("app -&gt; parser (calls)");
    expect(svg).toContain("recurses");
    expect(svg.match(/<circle /g)?.length).toBe(4);
    expect(svg.match(/marker-end="url\(#pi-network-arrow\)"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(layout.plotWidthPx).toBeGreaterThan(0);
    expect(layout.plotHeightPx).toBeGreaterThan(0);
  });
  for (const workflow of frozenWorkflowInputs) {
    for (const width of [60, 28]) {
      test(`${workflow.name} at width ${width} keeps semantic layers disjoint`, () => {
        const svg = renderFrozenWorkflow(workflow.input, width);
        const visibleTexts = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(
          (match) => match[1],
        );
        const expectedLabels = [
          ...workflow.input.nodes.map((node) => node.label),
          ...workflow.input.edges.flatMap((edge) => ("label" in edge ? [edge.label] : [])),
        ];
        expect(visibleTexts).toHaveLength(expectedLabels.length);
        for (const label of expectedLabels) expect(visibleTexts).toContain(label);
        expect(svg).not.toContain("<rect");
        if (workflow.name === "full" && width === 28) {
          const orderedEdges = [...workflow.input.edges].sort(
            (a, b) =>
              workflow.input.nodes.findIndex((node) => node.id === a.source) -
                workflow.input.nodes.findIndex((node) => node.id === b.source) ||
              workflow.input.nodes.findIndex((node) => node.id === a.target) -
                workflow.input.nodes.findIndex((node) => node.id === b.target),
          );
          const routes = [...svg.matchAll(/<path d="([^"]+)"[^>]*marker-end=/g)];
          const approaches: { x: number; y: number }[] = [];
          const channels = [
            ["inspect", "validated"],
            ["inspect", "blocked"],
            ["validated", "publish"],
          ].map(([source, target]) => {
            const index = orderedEdges.findIndex(
              (edge) => edge.source === source && edge.target === target,
            );
            const route = required(routes[index], `missing route for ${source} -> ${target}`);
            const routePath = required(route[1], `missing route path for ${source} -> ${target}`);
            const points = [...routePath.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map((match) => ({
              x: Number(match[1]),
              y: Number(match[2]),
            }));
            const turn = required(points.at(-3), "missing route turn");
            const approach = required(points.at(-2), "missing route approach");
            const endpoint = required(points.at(-1), "missing route endpoint");
            const first = required(points[0], "missing route start");
            expect(turn.y).toBe(approach.y);
            expect(Math.abs(turn.x - approach.x)).toBeGreaterThanOrEqual(12);
            expect(approach.x).toBe(endpoint.x);
            expect(Math.abs(approach.y - endpoint.y)).toBeCloseTo(12);
            approaches.push(approach);
            return points.slice(1).flatMap((point, index) => {
              const previousPoint = required(points[index], "missing route point");
              return point.x > Math.min(first.x, endpoint.x) &&
                point.x === previousPoint.x &&
                Math.abs(point.y - previousPoint.y) >= 24
                ? [
                    {
                      x: point.x,
                      top: Math.min(point.y, previousPoint.y),
                      bottom: Math.max(point.y, previousPoint.y),
                    },
                  ]
                : [];
            });
          });
          for (let left = 0; left < channels.length; left += 1) {
            const leftChannel = required(channels[left], "missing routed channel");
            const leftApproach = required(approaches[left], "missing routed approach");
            expect(leftChannel.length).toBeGreaterThan(0);
            const lane = Math.max(...leftChannel.map((segment) => segment.x));
            for (let right = left + 1; right < channels.length; right += 1) {
              const rightChannel = required(channels[right], "missing routed channel");
              const rightApproach = required(approaches[right], "missing routed approach");
              expect(
                Math.abs(lane - Math.max(...rightChannel.map((segment) => segment.x))),
              ).toBeGreaterThanOrEqual(12);
              expect(Math.abs(leftApproach.y - rightApproach.y)).toBeGreaterThanOrEqual(12);
            }
            for (const a of leftChannel) {
              for (const right of channels.slice(left + 1)) {
                for (const b of right) {
                  if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 24) continue;
                  expect(
                    Math.abs(a.x - b.x),
                    "decision and publication channels need 12px clearance",
                  ).toBeGreaterThanOrEqual(12);
                }
              }
            }
          }
          expect(svg).toBe(renderFrozenWorkflow(workflow.input, width));
        }
        const masks = new Map(
          collisionCategories.map((category) => [category, renderCollisionMask(svg, category)]),
        );
        for (const category of ["node-label", "edge-label"] as const) {
          const actual = renderCollisionMask(svg, category, undefined, false);
          const outlined = required(masks.get(category), `missing ${category} mask`);
          let changedInkPixels = 0;
          for (let offset = 3; offset < actual.pixels.length; offset += 4) {
            const actualAlpha = required(actual.pixels[offset], "missing actual pixel");
            const outlinedAlpha = required(outlined.pixels[offset], "missing outlined pixel");
            if (actualAlpha >= 16 !== outlinedAlpha >= 16) changedInkPixels += 1;
          }
          expect(changedInkPixels, "outlined masks preserve actual raster ink").toBe(0);
          const count =
            category === "node-label"
              ? workflow.input.nodes.length
              : expectedLabels.length - workflow.input.nodes.length;
          let occupied: Raster | undefined;
          for (let index = 0; index < count; index += 1) {
            const label = renderCollisionMask(svg, category, index);
            expect(label.pixels.some((value, index) => index % 4 === 3 && value >= 16)).toBe(true);
            if (occupied === undefined) occupied = label;
            else {
              expect(
                collisionPixels(occupied, label).pixels,
                `${category} ${index} overlaps another label`,
              ).toBe(0);
              for (let offset = 3; offset < occupied.pixels.length; offset += 4) {
                const occupiedAlpha = required(occupied.pixels[offset], "missing occupied pixel");
                const labelAlpha = required(label.pixels[offset], "missing label pixel");
                occupied.pixels[offset] = Math.max(occupiedAlpha, labelAlpha);
              }
            }
          }
        }
        for (let leftIndex = 0; leftIndex < collisionCategories.length; leftIndex += 1) {
          for (
            let rightIndex = leftIndex + 1;
            rightIndex < collisionCategories.length;
            rightIndex += 1
          ) {
            const left = collisionCategories[leftIndex];
            const right = collisionCategories[rightIndex];
            if (left === undefined || right === undefined) continue;
            if (
              (left === "nodes" && (right === "strokes" || right === "arrowheads")) ||
              (right === "nodes" && (left === "strokes" || left === "arrowheads")) ||
              (left === "strokes" && right === "arrowheads")
            ) {
              continue;
            }
            const leftMask = required(masks.get(left), `missing ${left} mask`);
            const rightMask = required(masks.get(right), `missing ${right} mask`);
            const collision = collisionPixels(leftMask, rightMask);
            expect(
              collision.pixels,
              `${workflow.name} width ${width}: ${left} owns pixels with ${right} at ${JSON.stringify(collision.bounds)}`,
            ).toBe(0);
          }
        }
      });
    }

    test(`${workflow.name} workflow allocates deterministic SCC lanes`, () => {
      const svg = renderFrozenWorkflow(workflow.input);
      const routes = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke-dasharray="4 3"/g)].map(
        (match) => required(match[1], "missing routed path"),
      );
      expect(routes).toHaveLength(3);
      const lanes = routes.map((route) => {
        const points = [...route.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map((match) => ({
          x: Number(match[1]),
          y: Number(match[2]),
        }));
        const verticals = points.slice(1).flatMap((point, index) => {
          const previous = required(points[index], "missing routed point");
          return point.x === previous.x
            ? [{ x: point.x, length: Math.abs(point.y - previous.y) }]
            : [];
        });
        return verticals.sort((a, b) => b.length - a.length)[0]?.x;
      });
      expect(lanes.every((lane) => lane !== undefined)).toBe(true);
      expect(new Set(lanes).size).toBe(3);
      expect(svg).toBe(renderFrozenWorkflow(workflow.input));
    });
  }

  test("keeps authored order from top to bottom within a layer", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters({
        type: "network",
        nodes: [
          { id: "first", label: "First" },
          { id: "second", label: "Second" },
          { id: "third", label: "Third" },
        ],
        edges: [
          { source: "first", target: "third" },
          { source: "third", target: "first" },
        ],
      }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const svg = networkChartRenderer.renderSvg(
      details,
      theme,
      networkChartRenderer.getLayout(details, undefined, details.imageWidthCells),
    );
    const yPositions = [...svg.matchAll(/<circle[^>]*cy="([^"]+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(yPositions[0]).toBeLessThan(yPositions[1] ?? Number.POSITIVE_INFINITY);
    expect(yPositions[1]).toBeLessThan(yPositions[2] ?? Number.POSITIVE_INFINITY);
  });
  test("keeps first-layer loops and reciprocal routes inside the viewport", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters({
        type: "network",
        nodes: [
          { id: "first", label: "First" },
          { id: "second", label: "Second" },
        ],
        edges: [
          { source: "first", target: "first", label: "loop" },
          { source: "first", target: "second", label: "forward" },
          { source: "second", target: "first", label: "back" },
        ],
      }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const svg = networkChartRenderer.renderSvg(
      details,
      theme,
      networkChartRenderer.getLayout(details, undefined, details.imageWidthCells),
    );
    expect(svg).not.toContain('d="M 4 4 C -');
    expect(svg).not.toContain('d="M 4 34.5 C -');
    expect(svg.match(/<text x="(-?\d+(?:\.\d+)?)"/g)?.every((text) => !text.includes('x="-'))).toBe(
      true,
    );
  });

  test("produces stable output for the same authored node and edge order", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters(input),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = networkChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    expect(networkChartRenderer.renderSvg(details, theme, layout)).toBe(
      networkChartRenderer.renderSvg(details, theme, layout),
    );
  });

  test("keeps the maximum escaped graph within the raster SVG budget", async () => {
    const nodes = Array.from({ length: 64 }, (_, index) => ({
      id: `${"&".repeat(118)}${String(index).padStart(2, "0")}`,
      label: "&".repeat(40),
    }));
    const edges: NetworkChartInput["edges"] = [];
    for (let source = 0; source < nodes.length && edges.length < 128; source += 1) {
      for (let target = 0; target < nodes.length && edges.length < 128; target += 1) {
        if (source !== target) {
          edges.push({ source: nodes[source]?.id ?? "", target: nodes[target]?.id ?? "" });
        }
      }
    }
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters({ type: "network", nodes, edges }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = networkChartRenderer.getLayout(details, undefined, details.imageWidthCells);
    const svg = networkChartRenderer.renderSvg(details, theme, layout);
    expect(layout.heightCells).toBeGreaterThan(18);
    expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
    expect(svg).toContain("accompanying text result");
    const result = await createNetworkChartTool().execute(
      "network-max",
      { nodes, edges },
      undefined,
      undefined,
      printContext,
    );
    expect(result.content.map((part) => part.type)).toEqual(["text", "image"]);
  });
  test("compacts broad layers to the requested height while retaining nodes", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      source: nodes[0]?.id ?? "",
      target: node.id,
      label: `edge-${index}`,
    }));
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters({
        type: "network",
        nodes,
        edges,
        maxHeightCells: 8,
      }),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = networkChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = networkChartRenderer.renderSvg(details, theme, layout);
    expect(layout.heightCells).toBeLessThanOrEqual(8);
    expect(svg.match(/<circle /g)?.length).toBe(12);
    expect(svg.match(/>edge-\d+</g)?.length ?? 0).toBeLessThan(edges.length);
    expect(svg.match(/<text\b[^>]*>Node \d+</g) ?? []).toHaveLength(1);
  });

  test("round-trips replay details and rejects malformed graph structures", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters({ ...input, maxHeightCells: 24 }),
      { imageWidthCells: 60, fontFamily: "sans-serif", fontSize: 16 },
    );
    expect(networkChartRenderer.deserializeDetails(details)).toEqual(details);
    expect(
      networkChartRenderer.deserializeDetails({
        ...details,
        edges: [{ source: "app", target: "missing" }],
      }),
    ).toBeUndefined();
  });

  test("executes through the public tool and returns exact TUI text", async () => {
    const { type: _type, ...parameters } = input;
    const result = await createNetworkChartTool().execute(
      "network",
      parameters,
      undefined,
      undefined,
      context,
    );
    expect(result.content.map((part) => part.type)).toEqual(["text"]);
    expect(result.content.find((part) => part.type === "text")?.text).toContain(
      "Repository calls network chart",
    );
    let error: unknown;
    try {
      await createNetworkChartTool().execute(
        "invalid",
        { ...parameters, type: "network" } as never,
        undefined,
        undefined,
        context,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain(
      "invalid network chart parameters",
    );
  });

  test("rasterizes a network outside TUI", async () => {
    const { type: _type, ...parameters } = input;
    const result = await createNetworkChartTool().execute(
      "network",
      parameters,
      undefined,
      undefined,
      printContext,
    );
    expect(result.content.map((part) => part.type)).toEqual(["text", "image"]);
  });
});
