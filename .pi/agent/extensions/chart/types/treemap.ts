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
  getContrastingTextColor,
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

type TreemapTile = Pick<SceneRect, "x" | "y" | "width" | "height">;
type TreemapSceneLabel = Extract<SceneNode, { kind: "label" }>;
type TreemapLabelBox = TreemapTile;
type TreemapLabelPlan = {
  row: HierarchyRow;
  tile: TreemapTile;
  structural: boolean;
  x: number;
  y: number;
  candidates: string[];
  index: number;
};

function getTreemapRowId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("data" in value)) return undefined;
  const data = value.data;
  if (typeof data !== "object" || data === null || !("id" in data)) return undefined;
  return typeof data.id === "string" ? data.id : undefined;
}

function collectTreemapSceneParts(nodes: readonly SceneNode[]): {
  tiles: Map<string, TreemapTile>;
  nativeLabels: Map<string, TreemapSceneLabel>;
} {
  const tiles = new Map<string, TreemapTile>();
  const nativeLabels = new Map<string, TreemapSceneLabel>();
  const visit = (children: readonly SceneNode[]): void => {
    for (const node of children) {
      if (node.kind === "group") {
        visit(node.children);
      } else if (node.kind === "rect") {
        const id = getTreemapRowId(node.interaction?.point?.datum);
        if (
          id !== undefined &&
          node.width > 0 &&
          node.height > 0 &&
          [node.x, node.y, node.width, node.height].every(Number.isFinite)
        ) {
          tiles.set(id, { x: node.x, y: node.y, width: node.width, height: node.height });
        }
      } else if (node.kind === "label") {
        const id = getTreemapRowId(node.pointOwner?.datum);
        if (id !== undefined) nativeLabels.set(id, node);
      }
    }
  };
  visit(nodes);
  return { tiles, nativeLabels };
}

function unionTreemapTiles(left: TreemapTile, right: TreemapTile): TreemapTile {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function treemapLabelCandidates(row: HierarchyRow, unit: string | undefined): string[] {
  const suffix = `${readable(row.total)}${unit ? ` ${unit}` : ""}`;
  const paths = row.path.map((_, index) => row.path.slice(index).join(" / "));
  return [...paths.map((path) => `${path}: ${suffix}`), ...paths];
}

function chooseTreemapLabel(
  candidates: readonly string[],
  tile: TreemapTile,
  fontSizePx: number,
): string | undefined {
  const horizontalPadding = 5;
  const verticalPadding = 5;
  const availableWidth = tile.width - horizontalPadding * 2;
  const availableHeight = tile.height - verticalPadding * 2;
  const lineHeight = fontSizePx * 1.2;
  if (availableWidth <= 0 || availableHeight < lineHeight) return undefined;
  return candidates.find((candidate) => candidate.length * fontSizePx * 0.58 <= availableWidth);
}

function isSufficientlyLargeTreemapTile(tile: TreemapTile, fontSizePx: number): boolean {
  // Fallback labels should not turn subpixel or barely painted tiles into noisy text.
  return tile.width >= fontSizePx * 4 && tile.height >= fontSizePx * 2.5;
}

function getTreemapLabelBox(
  label: Pick<TreemapSceneLabel, "x" | "y" | "text" | "anchor" | "baseline" | "fontSize">,
): TreemapLabelBox {
  const fontSize = label.fontSize ?? 16;
  const width = label.text.length * fontSize * 0.58;
  const height = fontSize * 1.2;
  const x =
    label.anchor === "middle"
      ? label.x - width / 2
      : label.anchor === "end"
        ? label.x - width
        : label.x;
  const y =
    label.baseline === "middle"
      ? label.y - height / 2
      : label.baseline === "hanging"
        ? label.y
        : label.y - fontSize * 0.8;
  return { x, y, width, height };
}

function clipTreemapLabelBox(box: TreemapLabelBox, tile: TreemapTile): TreemapLabelBox | undefined {
  const x = Math.max(box.x, tile.x);
  const y = Math.max(box.y, tile.y);
  const right = Math.min(box.x + box.width, tile.x + tile.width);
  const bottom = Math.min(box.y + box.height, tile.y + tile.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

function treemapLabelBoxesOverlap(left: TreemapLabelBox, right: TreemapLabelBox): boolean {
  return (
    Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
    Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y)
  );
}

function createNestedTreemapLabels(
  rows: readonly HierarchyRow[],
  details: TreemapChartDetails,
  layout: TreemapChartLayout,
  scene: { nodes: readonly SceneNode[] },
): SceneNode[] {
  const { tiles, nativeLabels } = collectTreemapSceneParts(scene.nodes);
  const childrenByParent = new Map<string, HierarchyRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const children = childrenByParent.get(row.parentId) ?? [];
    children.push(row);
    childrenByParent.set(row.parentId, children);
  }
  const boundsById = new Map<string, TreemapTile | undefined>();
  const boundsFor = (id: string): TreemapTile | undefined => {
    if (boundsById.has(id)) return boundsById.get(id);
    const ownTile = tiles.get(id);
    if (ownTile !== undefined) {
      boundsById.set(id, ownTile);
      return ownTile;
    }
    let bounds: TreemapTile | undefined;
    for (const child of childrenByParent.get(id) ?? []) {
      const childBounds = boundsFor(child.id);
      if (childBounds !== undefined)
        bounds = bounds === undefined ? childBounds : unionTreemapTiles(bounds, childBounds);
    }
    boundsById.set(id, bounds);
    return bounds;
  };

  const lineHeight = layout.fontSizePx * 1.2;
  const lineGap = 2;
  const plans: TreemapLabelPlan[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    const tile = boundsFor(row.id);
    if (
      tile === undefined ||
      row.total <= 0 ||
      !isSufficientlyLargeTreemapTile(tile, layout.fontSizePx)
    )
      continue;
    const structural = row.contribution === 0;
    if (!structural && nativeLabels.has(row.id)) continue;

    const candidates = treemapLabelCandidates(row, details.unit).filter(
      (candidate) => chooseTreemapLabel([candidate], tile, layout.fontSizePx) !== undefined,
    );
    if (candidates.length === 0) continue;

    const x = structural ? tile.x + 5 : tile.x + tile.width / 2;
    const centeredY = tile.y + tile.height / 2;
    const headerY = tile.y + 5 + (row.path.length - 1) * (lineHeight + lineGap) + lineHeight / 2;
    const y = structural
      ? tile.y + 5 + (row.path.length - 1) * (lineHeight + lineGap)
      : headerY + lineHeight / 2 <= tile.y + tile.height - 2
        ? headerY
        : centeredY;
    plans.push({ row, tile, structural, x, y, candidates, index });
  }

  const occupied = [...nativeLabels.entries()].flatMap(([id, label]) => {
    const box = getTreemapLabelBox(label);
    const tile = tiles.get(id);
    const clipped = tile === undefined ? box : clipTreemapLabelBox(box, tile);
    return clipped === undefined ? [] : [clipped];
  });
  const accepted = new Map<string, SceneNode>();
  // Leaf labels carry the most specific information, so retain them before broad parent headers.
  const prioritized = [...plans].sort(
    (left, right) =>
      Number(right.row.contribution > 0) - Number(left.row.contribution > 0) ||
      left.index - right.index,
  );
  for (const plan of prioritized) {
    for (const text of plan.candidates) {
      const label: TreemapSceneLabel = {
        kind: "label",
        key: `treemap-0:nested-label:${plan.row.id}`,
        x: plan.x,
        y: plan.y,
        text,
        anchor: plan.structural ? "start" : "middle",
        baseline: plan.structural ? "hanging" : "middle",
        fontSize: layout.fontSizePx,
        style: {
          fill: getContrastingTextColor(
            FIXED_CHART_PALETTE[plan.row.group] ?? FIXED_CHART_PALETTE[0] ?? "#579aca",
          ),
        },
      };
      const box = clipTreemapLabelBox(getTreemapLabelBox(label), plan.tile);
      if (box === undefined || occupied.some((other) => treemapLabelBoxesOverlap(box, other)))
        continue;
      occupied.push(box);
      accepted.set(plan.row.id, {
        kind: "group",
        key: `${label.key}:clip`,
        clip: { x: plan.tile.x, y: plan.tile.y, width: plan.tile.width, height: plan.tile.height },
        children: [label],
      });
      break;
    }
  }
  return plans.flatMap((plan) => {
    const label = accepted.get(plan.row.id);
    return label === undefined ? [] : [label];
  });
}

function appendNestedTreemapLabels(
  nodes: readonly SceneNode[],
  labels: readonly SceneNode[],
): SceneNode[] {
  return nodes.map((node) => {
    if (node.kind !== "group") return node;
    const children = appendNestedTreemapLabels(node.children, labels);
    return node.className?.includes("ts-chart__treemap")
      ? { ...node, children: [...children, ...labels] }
      : { ...node, children };
  });
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
          labelFill: (node) =>
            getContrastingTextColor(FIXED_CHART_PALETTE[node.data?.group ?? 0] ?? "#579aca"),
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
  const nestedLabels = createNestedTreemapLabels(rows, details, layout, scene);
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
  return { ...scene, nodes: clipLabels(appendNestedTreemapLabels(scene.nodes, nestedLabels)) };
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
