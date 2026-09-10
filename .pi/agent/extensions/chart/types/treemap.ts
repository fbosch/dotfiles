import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
  type SceneNode,
  type SceneRect,
} from "@tanstack/charts";
import { treemap } from "@tanstack/charts/hierarchy/treemap";
import { match } from "ts-pattern";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  hasBoundedTreemapHierarchy,
  type TreemapChartInput,
  type TreemapNodeInput,
  treemapChartVariant,
} from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartTheme,
  type ChartType,
  escapeXml,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

import {
  clampChartPlotHeightPx,
  deserializeChartDetails,
  FIXED_CHART_PALETTE,
  finalizeChartLayout,
  isValidChartHeight,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { TreemapChartInput };
export { treemapChartVariant };
export type TreemapChartData = Omit<TreemapChartInput, "type">;
export type TreemapChartDetails = ChartDetails & TreemapChartData & { type: "treemap" };
export type TreemapChartLayout = ChartLayout & {
  plotY: number;
  plotHeightPx: number;
  fontSizePx: number;
};
// Fixed group-index colors keep hierarchy identity stable across leaves.
function normalizeTreemapChartInput(input: TreemapChartInput): TreemapChartData {
  if (input.maxHeightCells !== undefined && !isValidChartHeight(input.maxHeightCells))
    throw new Error("invalid chart height");
  const normalize = (nodes: TreemapNodeInput[]): void => {
    const labels = new Set<string>();
    for (const node of nodes) {
      const label = node.label.trim();
      if (!label || labels.has(label))
        throw new Error("treemap sibling labels must be unique and nonblank after trimming");
      labels.add(label);
      node.label = label;
      if ("children" in node) normalize(node.children);
      else if (!Number.isFinite(node.value) || node.value < 0)
        throw new Error("treemap leaf values must be finite and nonnegative");
    }
  };
  const data = structuredClone(input.data);
  normalize(data);
  const text = (value: string | undefined, name: string) => {
    if (value?.trim() === "") throw new Error(`${name} must not be blank`);
    return value?.trim();
  };
  const title = text(input.title, "title");
  const unit = text(input.unit, "unit");
  const result = {
    data,
    ...(title === undefined ? {} : { title }),
    ...(unit === undefined ? {} : { unit }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
  const { total } = getTreemapHierarchy(result);
  if (total === 0) throw new Error("treemap requires at least one positive leaf value");
  return result;
}

export function validateTreemapChartInput(input: TreemapChartInput): TreemapChartData {
  if (!hasBoundedTreemapHierarchy(input) || !Value.Check(treemapChartVariant, input))
    throw new Error("invalid treemap chart parameters");
  return normalizeTreemapChartInput(input);
}

const detailsSchema = Type.Object(
  {
    ...treemapChartVariant.properties,
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeTreemapChartDetails(value: unknown): TreemapChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => normalizeTreemapChartInput(input as TreemapChartInput),
    (data, settings) => ({ type: "treemap", ...data, ...settings }),
    { precondition: hasBoundedTreemapHierarchy },
  );
}

type HierarchyRow = {
  id: string;
  parentId: string | null;
  path: string[];
  group: number;
  contribution: number;
  total: number;
};
export function getTreemapHierarchy(details: TreemapChartData): {
  rows: HierarchyRow[];
  total: number;
} {
  const rows: HierarchyRow[] = [];
  const visit = (
    node: TreemapNodeInput,
    id: string,
    parentId: string,
    path: string[],
    group: number,
  ): number => {
    const row: HierarchyRow = {
      id,
      parentId,
      path: [...path, node.label],
      group,
      contribution: "value" in node ? node.value : 0,
      total: 0,
    };
    rows.push(row);
    row.total =
      "children" in node
        ? node.children.reduce(
            (sum, child, index) => sum + visit(child, `${id}.${index}`, id, row.path, group),
            0,
          )
        : node.value;
    if (!Number.isFinite(row.total)) throw new Error("treemap aggregate totals must be finite");
    return row.total;
  };
  const total = details.data.reduce(
    (sum, node, index) => sum + visit(node, String(index), "root", [], index),
    0,
  );
  if (!Number.isFinite(total)) throw new Error("treemap aggregate totals must be finite");
  // Structural rows contribute zero: supplying their totals would double-count descendants in TanStack.
  rows.unshift({ id: "root", parentId: null, path: [], group: 0, contribution: 0, total });
  return { rows, total };
}

export function getTreemapChartSummary(details: TreemapChartDetails): string {
  const { rows, total } = getTreemapHierarchy(details);
  const suffix = details.unit ? ` ${details.unit}` : "";
  return `${details.title ?? "Treemap"}; total=${total}${suffix}: ${rows
    .slice(1)
    .map((row) => `${JSON.stringify(row.path)}=${row.total}${suffix}`)
    .join("; ")}`;
}

export function getTreemapChartLayout(
  details: TreemapChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): TreemapChartLayout {
  const cells = validCellDimensions(cellDimensions ?? { widthPx: NaN, heightPx: NaN });
  const widthPx = Math.max(1, Math.round(width * cells.widthPx));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const plotY = details.title ? fontSizePx * 2 : 0;
  const naturalPlotHeightPx = Math.max(
    1,
    Math.round(Math.min(widthPx * 0.65, cells.heightPx * 12)),
  );
  const fixedHeightPx = plotY + fontSizePx * (1 + details.data.length * 1.4);
  // TanStack rounds tile coordinates; integral dimensions keep rounded edges inside the plot.
  const plotHeightPx = Math.max(
    1,
    Math.floor(
      details.maxHeightCells === undefined
        ? naturalPlotHeightPx
        : clampChartPlotHeightPx(
            naturalPlotHeightPx,
            details.maxHeightCells,
            cells.heightPx,
            fixedHeightPx,
            undefined,
          ),
    ),
  );
  const heightPx = Math.ceil(plotY + plotHeightPx + fontSizePx * (1 + details.data.length * 1.4));
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotY,
      plotHeightPx,
      fontSizePx,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

function readable(value: number): string {
  const rounded = Number(value.toPrecision(3));
  return String(Number.isFinite(rounded) ? rounded : value);
}

export function createTreemapScene(
  details: TreemapChartDetails,
  layout = getTreemapChartLayout(details),
) {
  const { rows, total } = getTreemapHierarchy(details);
  const scene = createChartScene(
    defineChart({
      marks: [
        treemap(rows, {
          nodeId: "id",
          parentId: "parentId",
          // Unit contributions prevent squarify's squared-value arithmetic overflowing or underflowing.
          value: (row) => row.contribution / total,
          fill: (node) => FIXED_CHART_PALETTE[node.data?.group ?? 0] ?? "#579aca",
          // Integer pixels avoid epsilon overshoot rejected by TanStack's strict layout bounds check.
          round: true,
          inset: 0,
          stroke: "#202020",
          strokeWidth: 0.5,
          label: (node) =>
            node.data
              ? `${node.data.path.join(" / ")}: ${readable(node.data.total)}${details.unit ? ` ${details.unit}` : ""}`
              : "",
          labelFill: "#101010",
          labelFontSize: layout.fontSizePx,
          labelPadding: 5,
        }),
      ],
      scales: { x: null, y: null },
      margin: 0,
      focus: false,
    }),
    { width: layout.widthPx, height: layout.plotHeightPx },
  );
  // Native fit checks omit tiny labels. Clip retained labels to their own tiles as a final guard
  // against font substitution differing from the deterministic scene text estimator.
  const clipLabels = (nodes: readonly SceneNode[]): SceneNode[] => {
    const tiles = new Map<string, SceneRect>();
    for (const node of nodes) if (node.kind === "rect") tiles.set(node.key, node);
    return nodes.map((node) =>
      match(node)
        .returnType<SceneNode>()
        .with({ kind: "group" }, (group) => ({ ...group, children: clipLabels(group.children) }))
        .with({ kind: "label" }, (label) => {
          const tile = tiles.get(label.pointOwner?.key ?? "");
          return tile
            ? {
                kind: "group",
                key: `${label.key}:clip`,
                clip: { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
                children: [label],
              }
            : label;
        })
        .otherwise((node) => node),
    );
  };
  return { ...scene, nodes: clipLabels(scene.nodes) };
}

export function renderTreemapChartSvg(
  details: TreemapChartDetails,
  theme: ChartTheme,
  layout = getTreemapChartLayout(details),
): string {
  const scene = createTreemapScene(details, layout);
  const plot = stripTanStackSvg(
    renderTanStackChartSvg(scene, { idPrefix: "pi-treemap", ariaLabel: "Treemap tiles" }),
  );
  const font = layout.fontSizePx;
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const shorten = (value: string) => {
    const length = Math.max(0, Math.floor((layout.widthPx - font * 1.5) / font));
    return length === 0 ? "" : value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  };
  const text = (value: string, x: number, y: number) =>
    `<text x="${x}" y="${y}" font-size="${font}" fill="${foreground}">${escapeXml(shorten(value))}</text>`;
  const { rows } = getTreemapHierarchy(details);
  const legend = rows
    .filter((row) => row.parentId === "root")
    .map((row, i) => {
      const y = layout.plotY + layout.plotHeightPx + font * (1.4 + i * 1.4);
      return (
        `<rect x="0" y="${y - font * 0.7}" width="${font * 0.7}" height="${font * 0.7}" fill="${FIXED_CHART_PALETTE[row.group]}"/>` +
        text(
          `${row.path[0]}: ${readable(row.total)}${details.unit ? ` ${details.unit}` : ""}`,
          font,
          y,
        )
      );
    })
    .join("");
  const name = details.title ?? "Treemap";
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: details.fontFamily ?? "sans-serif",
    ariaLabel: name,
    content: `<title>${escapeXml(name)}</title><desc>${escapeXml(getTreemapChartSummary(details))}</desc><g transform="translate(0 ${layout.plotY})">${plot}</g>${details.title ? text(details.title, 0, font) : ""}${legend}`,
  });
}

export const treemapChartRenderer: ChartType<
  typeof treemapChartVariant,
  TreemapChartData,
  TreemapChartDetails,
  TreemapChartLayout
> = {
  renderingText: "Rendering treemap…",
  unavailableText: "Treemap unavailable",
  parameters: treemapChartVariant,
  parseParameters: validateTreemapChartInput,
  createDetails: (data, settings) => ({ type: "treemap", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getTreemapChartSummary,
  getLayout: getTreemapChartLayout,
  renderSvg: renderTreemapChartSvg,
  deserializeDetails: deserializeTreemapChartDetails,
};
