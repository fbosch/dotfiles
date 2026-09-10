import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  test("round-trips replay details and rejects malformed graph structures", () => {
    const details = networkChartRenderer.createDetails(
      networkChartRenderer.parseParameters(input),
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
