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
  fontSizePx: number;
};

function fitTreeLabel(value: string, maximumWidthPx: number, fontSizePx: number): string {
  if (estimateTextWidthPx(value, fontSizePx) <= maximumWidthPx) return value;
  if (maximumWidthPx < fontSizePx * 3.2) return "";
  return fitTextToWidth(value, maximumWidthPx, fontSizePx);
}

const TREE_NODE_LABEL_GAP_PX = 7;
const TREE_LINK_GAP_PX = 5;
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
  const naturalPlotHeightPx = Math.max(
    rowHeightPx * 2,
    details.data.length * rowHeightPx * (width < 40 ? 1.5 : 1),
  );
  const plotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    details.maxHeightCells,
    cells.heightPx,
    paddingPx * 2 + titleHeightPx,
    MAX_CHART_HEIGHT_CELLS,
  );
  const plotWidthPx = Math.max(1, widthPx - paddingPx * 2);
  const heightPx = paddingPx + titleHeightPx + plotHeightPx + paddingPx;
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX: paddingPx,
      plotY: paddingPx + titleHeightPx,
      plotWidthPx,
      plotHeightPx,
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

type TreeLabel = {
  id: string;
  x: number;
  y: number;
  label: string;
  anchor: "start" | "end";
};

type TreeLabelBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function labelBounds(label: TreeLabel, fontSizePx: number): TreeLabelBounds {
  const width = estimateTextWidthPx(label.label, fontSizePx);
  const left = label.anchor === "end" ? label.x - width : label.x;
  return {
    left,
    right: left + width,
    top: label.y - fontSizePx / 2 - 2,
    bottom: label.y + fontSizePx / 2 + 2,
  };
}

function boundsOverlap(a: TreeLabelBounds, b: TreeLabelBounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function linkCrossesLabel(linkRow: TreeLink, bounds: TreeLabelBounds): boolean {
  // Clip the segment parametrically, including horizontal and vertical segments.
  let enter = 0;
  let exit = 1;
  for (const [start, delta, minimum, maximum] of [
    [linkRow.x1, linkRow.x2 - linkRow.x1, bounds.left - 1, bounds.right + 1],
    [linkRow.y1, linkRow.y2 - linkRow.y1, bounds.top - 1, bounds.bottom + 1],
  ] as const) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return false;
    } else {
      const first = (minimum - start) / delta;
      const last = (maximum - start) / delta;
      enter = Math.max(enter, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
    }
  }
  return enter <= exit;
}

function createTreeRows(details: TreeChartDetails, layout: TreeChartLayout) {
  const hierarchy = treeLayout(details.data, {
    id: "id",
    parentId: "parentId",
    orientation: "left",
    nodeSize: [1, 1],
  });
  const root = hierarchy.nodes.find((node) => node.parentId === null);
  if (root === undefined) throw new Error("tree data must contain exactly one root");
  const children = new Map<string, TreeLayoutNode<TreeChartRow>[]>();
  for (const node of hierarchy.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const width = layout.plotWidthPx;
  const height = layout.plotHeightPx;
  const font = layout.fontSizePx;
  const gap = TREE_NODE_LABEL_GAP_PX;
  const nodeInset = 6;
  const minimumLink = 12;
  const textOf = (node: TreeLayoutNode<TreeChartRow>) => node.data?.label ?? node.name;
  const depth = Math.max(1, ...hierarchy.nodes.map((node) => node.x - root.x));
  const rootLabel = fitTreeLabel(textOf(root), Math.max(0, width * 0.4 - gap), font);
  const rootX = Math.max(nodeInset, estimateTextWidthPx(rootLabel, font) + gap);
  const leafReserve = (compacted: ReadonlySet<string>) =>
    Math.max(
      0,
      ...hierarchy.nodes
        .filter((node) => node.x - root.x === depth && !compacted.has(node.id))
        .map((node) => Math.min(width * 0.35, estimateTextWidthPx(textOf(node), font) + gap)),
    );
  const initialStep = Math.max(0, width - nodeInset - rootX - leafReserve(new Set())) / depth;

  // Compact entire same-row unary chains before allocating columns. Their path
  // label sits above the chain; every original node and parent link remains.
  const paths = new Map<string, TreeLayoutNode<TreeChartRow>[]>();
  const compacted = new Set<string>();
  for (const node of hierarchy.nodes) {
    if (node.id === root.id || compacted.has(node.id)) continue;
    const chain = [node];
    let current = node;
    while (true) {
      const descendants = children.get(current.id);
      const child = descendants?.[0];
      if (descendants?.length !== 1 || child === undefined || child.y !== current.y) break;
      chain.push(child);
      current = child;
    }
    if (
      chain.length < 2 ||
      chain
        .slice(0, -1)
        .every(
          (member) =>
            estimateTextWidthPx(textOf(member), font) + gap + TREE_LINK_GAP_PX + minimumLink <=
            initialStep,
        )
    )
      continue;
    paths.set(node.id, chain);
    for (const member of chain) compacted.add(member.id);
  }

  const step = Math.max(0, width - nodeInset - rootX - leafReserve(compacted)) / depth;
  const yValues = hierarchy.nodes.map((node) => node.y);
  const yMinimum = Math.min(...yValues);
  const yMaximum = Math.max(...yValues);
  const top = Math.min(height / 2, font * 2);
  const bottom = Math.max(top, height - font);
  const nodes = hierarchy.nodes.map((node) => ({
    ...node,
    x: rootX + (node.x - root.x) * step,
    y:
      yMinimum === yMaximum
        ? height / 2
        : top + ((yMaximum - node.y) / (yMaximum - yMinimum)) * (bottom - top),
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const labels: TreeLabel[] = [];
  const inlineWidths = new Map<string, number>();
  for (const node of nodes) {
    if (node.id === root.id) {
      labels.push({
        id: node.id,
        x: node.x - gap,
        y: node.y,
        label: rootLabel,
        anchor: "end",
      });
      continue;
    }
    const chain = paths.get(node.id);
    if (chain !== undefined) {
      const label = fitTreeLabel(chain.map(textOf).join(" / "), width - gap, font);
      const labelWidth = estimateTextWidthPx(label, font);
      labels.push({
        id: node.id,
        x: Math.max(0, Math.min(node.x, width - labelWidth)),
        y: node.y - font / 2 - gap - 3,
        label,
        anchor: "start",
      });
      continue;
    }
    if (compacted.has(node.id)) continue;
    const available = children.has(node.id)
      ? step - gap - TREE_LINK_GAP_PX - minimumLink
      : width - node.x - gap;
    const label = fitTreeLabel(textOf(node), Math.max(0, available), font);
    inlineWidths.set(
      node.id,
      label.length === 0 ? 0 : gap + estimateTextWidthPx(label, font) + TREE_LINK_GAP_PX,
    );
    labels.push({
      id: node.id,
      x: node.x + gap,
      y: node.y,
      label,
      anchor: "start",
    });
  }

  const links = hierarchy.links.map((linkRow) => {
    const source = nodesById.get(linkRow.source);
    const target = nodesById.get(linkRow.target);
    if (source === undefined || target === undefined)
      throw new Error("tree link must reference two nodes");
    return {
      ...linkRow,
      x1: source.x + Math.max(Math.min(nodeInset, step / 4), inlineWidths.get(source.id) ?? 0),
      y1: source.y,
      x2: target.x - Math.min(nodeInset, step / 4),
      y2: target.y,
    };
  });
  const occupied: TreeLabelBounds[] = [];
  const visibleLabels = labels.filter((label) => {
    if (label.label.length === 0) return false;
    const bounds = labelBounds(label, font);
    if (bounds.left < 0 || bounds.right > width || bounds.top < 0 || bounds.bottom > height)
      return false;
    if (occupied.some((previous) => boundsOverlap(previous, bounds))) return false;
    if (links.some((linkRow) => linkCrossesLabel(linkRow, bounds))) return false;
    if (
      nodes.some((node) =>
        boundsOverlap(bounds, {
          left: node.x - 5,
          right: node.x + 5,
          top: node.y - 5,
          bottom: node.y + 5,
        }),
      )
    )
      return false;
    occupied.push(bounds);
    return true;
  });
  // All marks and collision checks use these same pixel domains. No later
  // domain padding or automatic rescaling may invalidate the geometry plan.
  // Reversing the y domain cancels the chart engine’s upward-positive range.
  return {
    nodes,
    links,
    labels: visibleLabels,
    xDomain: [0, width],
    yDomain: [height, 0],
  };
}

function createTreeLabelMarks(
  labels: readonly TreeLabel[],
  foreground: string,
  fontSizePx: number,
) {
  return (["start", "end"] as const).map((anchor) =>
    text(
      labels.filter((label) => label.anchor === anchor),
      {
        x: "x",
        y: "y",
        text: "label",
        key: "id",
        fill: foreground,
        fontSize: fontSizePx,
        anchor,
      },
    ),
  );
}

export function createTreeScene(
  details: TreeChartDetails,
  theme?: ChartTheme,
  layout = getTreeChartLayout(details),
) {
  const { nodes, links, labels, xDomain, yDomain } = createTreeRows(details, layout);
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
        ...createTreeLabelMarks(labels, foreground, layout.fontSizePx),
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
