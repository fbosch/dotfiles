import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createTreeChartTool } from "../metadata";
import { chartTreeParameters } from "../schemas";
import {
  type TreeChartInput,
  treeChartRenderer,
  treeChartVariant,
  validateTreeChartInput,
} from "../types/tree";

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
