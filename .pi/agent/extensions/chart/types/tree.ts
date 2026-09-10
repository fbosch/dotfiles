import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  link,
  renderChartSvg as renderTanStackChartSvg,
  text,
} from "@tanstack/charts";
import {
  type TreeLayoutLink,
  type TreeLayoutNode,
  treeLayout,
} from "@tanstack/charts/hierarchy/tree";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  MAX_TITLE_LENGTH,
  MAX_TREE_ID_LENGTH,
  MAX_TREE_LABEL_LENGTH,
  type TreeChartInput,
  treeChartVariant,
} from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  escapeXml,
  getChartColors,
  MAX_CHART_HEIGHT_CELLS,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

import {
  clampChartPlotHeightPx,
  deserializeChartDetails,
  estimateTextWidthPx,
  finalizeChartLayout,
  fitTextToWidth,
  getAccessibleDescription,
  isValidChartHeight,
  normalizeBoundedText,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { TreeChartInput };
export { treeChartVariant };

export type TreeChartRow = {
  id: string;
  parentId: string | null;
  label: string;
};
export type TreeChartData = {
  data: TreeChartRow[];
  title?: string;
  maxHeightCells?: number;
};
export type TreeChartDetails = ChartDetails &
  TreeChartData & {
    type: "tree";
  };
export type TreeChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  labelWidthPx: number;
  fontSizePx: number;
};

function fitTreeLabel(value: string, maximumWidthPx: number, fontSizePx: number): string {
  if (maximumWidthPx < fontSizePx * 3.2) return "";
  return fitTextToWidth(value, maximumWidthPx, fontSizePx);
}

type TreeNode = TreeLayoutNode<TreeChartRow> & {
  label: string;
  labelAnchor: "start" | "end";
};
type TreeLink = TreeLayoutLink<TreeChartRow>;

function normalizeRow(row: TreeChartInput["data"][number], index: number): TreeChartRow {
  const id = row.id.trim();
  const label = row.label.trim();
  const parentId = row.parentId == null ? null : row.parentId.trim();
  if (id.length === 0 || id.length > MAX_TREE_ID_LENGTH) {
    throw new Error(`id ${index + 1} must be 1-${MAX_TREE_ID_LENGTH} characters`);
  }
  if (label.length === 0 || label.length > MAX_TREE_LABEL_LENGTH) {
    throw new Error(`label ${index + 1} must be 1-${MAX_TREE_LABEL_LENGTH} characters`);
  }
  if (parentId !== null && parentId.length === 0) {
    throw new Error(`parentId ${index + 1} must not be blank`);
  }
  return { id, parentId, label };
}

function assertTreeStructure(rows: readonly TreeChartRow[]): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`tree node IDs must be unique: ${row.id}`);
    ids.add(row.id);
  }

  const roots = rows.filter((row) => row.parentId === null);
  if (roots.length !== 1) throw new Error("tree data must contain exactly one root");
  for (const row of rows) {
    if (row.parentId !== null && !ids.has(row.parentId)) {
      throw new Error(`tree parentId does not reference a node: ${row.parentId}`);
    }
  }

  const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  const visiting = new Set<string>();
  const checked = new Set<string>();
  const visitParent = (id: string): void => {
    if (checked.has(id)) return;
    if (visiting.has(id)) throw new Error("tree data must be acyclic");
    visiting.add(id);
    const parentId = parentById.get(id);
    if (parentId !== undefined && parentId !== null) visitParent(parentId);
    visiting.delete(id);
    checked.add(id);
  };
  for (const row of rows) visitParent(row.id);

  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row.id);
    children.set(row.parentId, siblings);
  }
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) throw new Error("tree data must be acyclic");
    visited.add(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  const root = roots[0];
  if (root === undefined) throw new Error("tree data must contain exactly one root");
  visit(root.id);
  if (visited.size !== rows.length) throw new Error("tree data must form one connected hierarchy");
}

function normalizeTreeChartInput(input: TreeChartInput): TreeChartData {
  if (input.maxHeightCells !== undefined && !isValidChartHeight(input.maxHeightCells))
    throw new Error("invalid chart height");
  const data = input.data.map(normalizeRow);
  assertTreeStructure(data);
  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  return {
    data,
    ...(title === undefined ? {} : { title }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

export function validateTreeChartInput(input: TreeChartInput): TreeChartData {
  if (!Value.Check(treeChartVariant, input)) throw new Error("invalid tree chart parameters");
  return normalizeTreeChartInput(input);
}

const detailsSchema = Type.Object(
  {
    ...treeChartVariant.properties,
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeTreeChartDetails(value: unknown): TreeChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => normalizeTreeChartInput(input as TreeChartInput),
    (data, settings) => ({ type: "tree", ...data, ...settings }),
  );
}

function paddedDomain(values: readonly number[]): [number, number] {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = minimum === maximum ? 1 : (maximum - minimum) * 0.08;
  return [minimum - padding, maximum + padding];
}

export function getTreeChartLayout(
  details: TreeChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): TreeChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.max(1, Math.round(width * cells.widthPx));
  const paddingPx = Math.max(8, Math.round(cells.widthPx * 1.25));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const titleHeightPx = details.title === undefined ? 0 : fontSizePx + paddingPx;
  const rowHeightPx = Math.max(Math.round(cells.heightPx * 1.25), fontSizePx + 7);
  const naturalPlotHeightPx = Math.max(rowHeightPx * 2, details.data.length * rowHeightPx);
  const plotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    details.maxHeightCells,
    cells.heightPx,
    paddingPx * 2 + titleHeightPx,
    MAX_CHART_HEIGHT_CELLS,
  );
  const minimumLabelWidthPx = Math.round(cells.widthPx * 8);
  const labelWidthPx = Math.min(
    Math.round(widthPx * 0.48),
    Math.max(
      minimumLabelWidthPx,
      ...details.data.map((row) => Math.ceil(estimateTextWidthPx(row.label, fontSizePx)) + 8),
    ),
  );
  const plotWidthPx = Math.max(
    Math.round(cells.widthPx * 8),
    widthPx - paddingPx * 2 - labelWidthPx,
  );
  const heightPx = paddingPx + titleHeightPx + plotHeightPx + paddingPx;
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX: paddingPx,
      plotY: paddingPx + titleHeightPx,
      plotWidthPx,
      plotHeightPx,
      labelWidthPx,
      fontSizePx,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

function formatTreeSummaryRow(row: TreeChartRow): string {
  return `${row.label} [${row.parentId === null ? `${row.id} root` : `${row.id} ← ${row.parentId}`}]`;
}

export function getTreeChartSummary(details: TreeChartDetails): string {
  return `${details.title === undefined ? "Tree chart" : `${details.title} tree chart`}: ${details.data.map(formatTreeSummaryRow).join("; ")}`;
}

function createTreeRows(
  details: TreeChartDetails,
  layout: TreeChartLayout,
): {
  nodes: TreeNode[];
  links: TreeLink[];
} {
  const hierarchy = treeLayout(details.data, {
    id: "id",
    parentId: "parentId",
    orientation: "left",
    nodeSize: [1, 1],
  });
  const xDomain = paddedDomain(hierarchy.nodes.map((node) => node.x));
  const pixelsPerUnit = layout.plotWidthPx / Math.max(xDomain[1] - xDomain[0], Number.EPSILON);
  const yDomain = paddedDomain(hierarchy.nodes.map((node) => node.y));
  const pixelsPerY = layout.plotHeightPx / Math.max(yDomain[1] - yDomain[0], Number.EPSILON);
  const firstChildX = new Map<string, number>();
  for (const linkRow of hierarchy.links) {
    const current = firstChildX.get(linkRow.source);
    if (current === undefined || linkRow.x2 < current) firstChildX.set(linkRow.source, linkRow.x2);
  }
  const candidates = hierarchy.nodes.map((node) => {
    const childX = firstChildX.get(node.id);
    const nodeX = (node.x - xDomain[0]) * pixelsPerUnit;
    const rightAvailableWidth =
      childX === undefined
        ? Math.max(0, layout.plotWidthPx - nodeX - 7)
        : Math.max(0, (childX - node.x) * pixelsPerUnit - 7 - 5);
    const leftAvailableWidth = Math.max(0, nodeX - 7);
    const canFitRight = rightAvailableWidth >= layout.fontSizePx * 3.2;
    const labelAnchor: TreeNode["labelAnchor"] =
      childX === undefined && !canFitRight && leftAvailableWidth >= layout.fontSizePx * 3.2
        ? "end"
        : "start";
    const availableLabelWidth = labelAnchor === "end" ? leftAvailableWidth : rightAvailableWidth;
    return {
      node,
      nodeX,
      nodeY: (node.y - yDomain[0]) * pixelsPerY,
      label: fitTreeLabel(
        node.data?.label ?? node.name,
        Math.min(layout.labelWidthPx, availableLabelWidth),
        layout.fontSizePx,
      ),
      labelAnchor,
    };
  });
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const nodes = candidates.map(({ node, nodeX, nodeY, label, labelAnchor }) => {
    const labelWidth = estimateTextWidthPx(label, layout.fontSizePx);
    const left = labelAnchor === "end" ? nodeX - 7 - labelWidth : nodeX + 7;
    const right = labelAnchor === "end" ? nodeX - 7 : left + labelWidth;
    const top = nodeY - layout.fontSizePx;
    const bottom = nodeY + 2;
    const overlaps =
      label.length > 0 &&
      occupied.some(
        (previous) =>
          previous.left < right + 2 &&
          previous.right + 2 > left &&
          previous.top < bottom + 2 &&
          previous.bottom + 2 > top,
      );
    const visibleLabel = overlaps ? "" : label;
    if (visibleLabel.length > 0) {
      const visibleWidth = estimateTextWidthPx(visibleLabel, layout.fontSizePx);
      occupied.push({
        left: labelAnchor === "end" ? nodeX - 7 - visibleWidth : nodeX + 7,
        right: labelAnchor === "end" ? nodeX - 7 : nodeX + 7 + visibleWidth,
        top,
        bottom,
      });
    }
    return { ...node, label: visibleLabel, labelAnchor };
  });
  const labelsById = new Map(nodes.map((node) => [node.id, node.label]));
  // Keep straight links out of their source labels while preserving node positions and authored order.
  const links = hierarchy.links.map((linkRow) => {
    const label = labelsById.get(linkRow.source) ?? "";
    const desiredOffsetPx = 7 + estimateTextWidthPx(label, layout.fontSizePx) + 5;
    const maximumOffsetPx = Math.max(0, (linkRow.x2 - linkRow.x1) * pixelsPerUnit - 4);
    const offsetPx = Math.min(desiredOffsetPx, maximumOffsetPx);
    return { ...linkRow, x1: linkRow.x1 + offsetPx / pixelsPerUnit };
  });
  return { nodes, links };
}

function createTreeLabelMarks(nodes: readonly TreeNode[], foreground: string, fontSizePx: number) {
  return (["start", "end"] as const).flatMap((anchor) => {
    const visibleNodes = nodes.filter(
      (node) => node.label.length > 0 && node.labelAnchor === anchor,
    );
    return visibleNodes.length === 0
      ? []
      : [
          text(visibleNodes, {
            x: "x",
            y: "y",
            text: "label",
            key: "id",
            fill: foreground,
            fontSize: fontSizePx,
            anchor,
            dx: anchor === "start" ? 7 : -7,
          }),
        ];
  });
}

export function createTreeScene(
  details: TreeChartDetails,
  theme?: ChartTheme,
  layout = getTreeChartLayout(details),
) {
  const { nodes, links } = createTreeRows(details, layout);
  const xDomain = paddedDomain(nodes.map((node) => node.x));
  const yDomain = paddedDomain(nodes.map((node) => node.y));
  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);
  const foreground =
    theme === undefined ? "#94a3b8" : ansiColor(theme.getFgAnsi("text"), "#94a3b8");
  const nodeColor = theme === undefined ? "#579aca" : (getChartColors(theme)[0] ?? "#579aca");
  return createChartScene(
    defineChart({
      marks: [
        link(links, {
          x1: "x1",
          y1: "y1",
          x2: "x2",
          y2: "y2",
          key: "id",
          stroke: foreground,
          strokeOpacity: 0.8,
          strokeWidth: 1.5,
        }),
        dot(nodes, {
          x: "x",
          y: "y",
          key: "id",
          fill: nodeColor,
          r: 4,
        }),
        ...createTreeLabelMarks(nodes, foreground, layout.fontSizePx),
      ],
      scales: {
        x: { scale: xScale, axis: false },
        y: { scale: yScale, axis: false },
      },
      guides: false,
      margin: 0,
      focus: false,
      pointer: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
}

export function renderTreeChartSvg(
  details: TreeChartDetails,
  theme: ChartTheme,
  layout = getTreeChartLayout(details),
): string {
  const scene = createTreeScene(details, theme, layout);
  const chartBody = stripTanStackSvg(
    renderTanStackChartSvg(scene, {
      ariaLabel: details.title === undefined ? "Tree chart" : `Tree chart: ${details.title}`,
      idPrefix: "pi-tree",
    }),
  )
    // Node IDs are nonvisual keys; dropping them keeps escaped user IDs out of the raster payload.
    .replace(/ data-ts-key="[^"]*"/g, "");
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const accessibleName =
    details.title === undefined ? "Tree chart" : `Tree chart: ${details.title}`;
  const summary = getTreeChartSummary(details);
  const accessibleDescription = getAccessibleDescription(
    summary,
    `Tree chart with ${details.data.length} nodes. The accompanying text result contains the exact node IDs and parent relationships.`,
  );
  const title =
    details.title === undefined
      ? ""
      : `<text x="${layout.plotX}" y="${layout.plotY - Math.round(layout.fontSizePx * 0.55)}" fill="${foreground}" font-family="${escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY)}" font-size="${layout.fontSizePx}">${escapeXml(details.title)}</text>`;
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: details.fontFamily ?? DEFAULT_FONT_FAMILY,
    ariaLabel: accessibleName,
    ariaDescription: accessibleDescription,
    content: `${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}</g>${title}`,
  });
}

export const treeChartRenderer: ChartType<
  typeof treeChartVariant,
  TreeChartData,
  TreeChartDetails,
  TreeChartLayout
> = {
  renderingText: "Rendering tree chart…",
  unavailableText: "Tree chart unavailable",
  parameters: treeChartVariant,
  parseParameters: validateTreeChartInput,
  createDetails(data, settings) {
    return {
      type: "tree",
      ...data,
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getTreeChartSummary,
  getLayout: getTreeChartLayout,
  renderSvg: renderTreeChartSvg,
  deserializeDetails: deserializeTreeChartDetails,
};
