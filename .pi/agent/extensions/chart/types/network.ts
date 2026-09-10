import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  link,
  renderChartSvg as renderTanStackChartSvg,
  text,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  MAX_NETWORK_EDGE_LABEL_LENGTH,
  MAX_NETWORK_GROUP_LENGTH,
  MAX_NETWORK_ID_LENGTH,
  MAX_NETWORK_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
  type NetworkChartInput,
  networkChartVariant,
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
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

import {
  deserializeChartDetails,
  ESTIMATED_CHARACTER_WIDTH,
  estimateTextWidthPx,
  finalizeChartLayout,
  fitTextToWidth,
  getAccessibleDescription,
  getChartHeightLimitPx,
  isValidChartHeight,
  normalizeBoundedText,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { NetworkChartInput };
export { networkChartVariant };

export type NetworkChartNode = {
  id: string;
  label: string;
  group?: string;
};

export type NetworkChartEdge = {
  source: string;
  target: string;
  label?: string;
};

export type NetworkChartData = {
  nodes: NetworkChartNode[];
  edges: NetworkChartEdge[];
  title?: string;
  maxHeightCells?: number;
};

export type NetworkChartDetails = ChartDetails &
  NetworkChartData & {
    type: "network";
  };

export type NetworkChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  labelWidthPx: number;
  fontSizePx: number;
  edgeLabelLimit: number;
};

type NetworkComponent = {
  key: number;
  members: number[];
  layer: number;
};

type NetworkTopology = {
  components: NetworkComponent[];
  componentByNode: number[];
  layers: number[][];
};

type PositionedNetworkNode = NetworkChartNode & {
  ordinal: number;
  component: number;
  layer: number;
  x: number;
  y: number;
  displayLabel: string;
  color: string;
};

type PositionedNetworkEdge = NetworkChartEdge & {
  ordinal: number;
  sourceNode: PositionedNetworkNode;
  targetNode: PositionedNetworkNode;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "forward" | "backward" | "same-layer" | "self";
  bendPx: number;
};

type NetworkRows = {
  nodes: PositionedNetworkNode[];
  forwardEdges: PositionedNetworkEdge[];
  manualEdges: PositionedNetworkEdge[];
};

const NODE_RADIUS_PX = 4;
const LABEL_OFFSET_PX = 7;
const LABEL_EDGE_GAP_PX = 5;
const TARGET_EDGE_GAP_PX = 4;
const MANUAL_EDGE_BEND_PX = 18;

const SELF_LOOP_LABEL_MARGIN_PX = 4;
function normalizeNode(row: NetworkChartInput["nodes"][number], index: number): NetworkChartNode {
  const id = row.id.trim();
  const label = row.label.trim();
  const group = normalizeBoundedText(row.group, `group ${index + 1}`, MAX_NETWORK_GROUP_LENGTH);
  if (id.length === 0 || id.length > MAX_NETWORK_ID_LENGTH) {
    throw new Error(`id ${index + 1} must be 1-${MAX_NETWORK_ID_LENGTH} characters`);
  }
  if (label.length === 0 || label.length > MAX_NETWORK_LABEL_LENGTH) {
    throw new Error(`label ${index + 1} must be 1-${MAX_NETWORK_LABEL_LENGTH} characters`);
  }
  return group === undefined ? { id, label } : { id, label, group };
}

function normalizeEdge(row: NetworkChartInput["edges"][number], index: number): NetworkChartEdge {
  const source = row.source.trim();
  const target = row.target.trim();
  if (source.length === 0 || source.length > MAX_NETWORK_ID_LENGTH) {
    throw new Error(`edge source ${index + 1} must be 1-${MAX_NETWORK_ID_LENGTH} characters`);
  }
  if (target.length === 0 || target.length > MAX_NETWORK_ID_LENGTH) {
    throw new Error(`edge target ${index + 1} must be 1-${MAX_NETWORK_ID_LENGTH} characters`);
  }
  const label = normalizeBoundedText(
    row.label,
    `edge label ${index + 1}`,
    MAX_NETWORK_EDGE_LABEL_LENGTH,
  );
  return label === undefined ? { source, target } : { source, target, label };
}

export function validateNetworkChartInput(input: NetworkChartInput): NetworkChartData {
  if (!Value.Check(networkChartVariant, input)) throw new Error("invalid network chart parameters");
  if (input.maxHeightCells !== undefined && !isValidChartHeight(input.maxHeightCells))
    throw new Error("invalid chart height");
  const nodes = input.nodes.map(normalizeNode);
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`network node IDs must be unique: ${node.id}`);
    ids.add(node.id);
  }

  const edges = input.edges.map(normalizeEdge);
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.source)) {
      throw new Error(`network edge source does not reference a node: ${edge.source}`);
    }
    if (!ids.has(edge.target)) {
      throw new Error(`network edge target does not reference a node: ${edge.target}`);
    }
    const key = JSON.stringify([edge.source, edge.target]);
    if (edgeKeys.has(key)) {
      throw new Error(`network directed edges must be unique: ${edge.source} -> ${edge.target}`);
    }
    edgeKeys.add(key);
  }

  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  return {
    nodes,
    edges,
    ...(title === undefined ? {} : { title }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

const detailsSchema = Type.Object(
  {
    ...networkChartVariant.properties,
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeNetworkChartDetails(value: unknown): NetworkChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => validateNetworkChartInput(input as NetworkChartInput),
    (data, settings) => ({ type: "network", ...data, ...settings }),
  );
}

function computeNetworkTopology(data: NetworkChartData): NetworkTopology {
  const nodeIndex = new Map(data.nodes.map((node, index) => [node.id, index]));
  const adjacency = data.nodes.map(() => [] as number[]);
  for (const edge of data.edges) {
    const source = nodeIndex.get(edge.source);
    const target = nodeIndex.get(edge.target);
    const neighbors = source === undefined ? undefined : adjacency[source];
    if (source === undefined || target === undefined || neighbors === undefined) {
      throw new Error("network edge endpoint is missing");
    }
    neighbors.push(target);
  }

  // Condense cycles before ranking so strongly connected call paths stay deterministic.
  const indices = data.nodes.map(() => -1);
  const lowLinks = data.nodes.map(() => -1);
  const stack: number[] = [];
  const onStack = new Set<number>();
  const components: NetworkComponent[] = [];
  let nextIndex = 0;

  const visit = (node: number): void => {
    const nodeIndexValue = nextIndex;
    indices[node] = nodeIndexValue;
    lowLinks[node] = nodeIndexValue;
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of adjacency[node] ?? []) {
      const targetIndexValue = indices[target];
      if (targetIndexValue === undefined) throw new Error("network node index is missing");
      if (targetIndexValue === -1) {
        visit(target);
        lowLinks[node] = Math.min(
          lowLinks[node] ?? nodeIndexValue,
          lowLinks[target] ?? nodeIndexValue,
        );
      } else if (onStack.has(target)) {
        lowLinks[node] = Math.min(lowLinks[node] ?? nodeIndexValue, targetIndexValue);
      }
    }

    if (lowLinks[node] !== nodeIndexValue) return;
    const members: number[] = [];
    let member: number | undefined;
    do {
      member = stack.pop();
      if (member === undefined) throw new Error("network SCC stack underflow");
      onStack.delete(member);
      members.push(member);
    } while (member !== node);
    members.sort((left, right) => left - right);
    components.push({ key: members[0] ?? node, members, layer: 0 });
  };

  for (let node = 0; node < data.nodes.length; node += 1) {
    if (indices[node] === -1) visit(node);
  }

  const componentByNode = data.nodes.map(() => -1);
  components.forEach((component, componentIndex) => {
    for (const member of component.members) componentByNode[member] = componentIndex;
  });
  const outgoing = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  for (const edge of data.edges) {
    const source = nodeIndex.get(edge.source);
    const target = nodeIndex.get(edge.target);
    if (source === undefined || target === undefined)
      throw new Error("network edge endpoint is missing");
    const sourceComponent = componentByNode[source];
    const targetComponent = componentByNode[target];
    const targets = sourceComponent === undefined ? undefined : outgoing[sourceComponent];
    if (sourceComponent === undefined || targetComponent === undefined || targets === undefined) {
      throw new Error("network component is missing");
    }
    if (sourceComponent === targetComponent) continue;
    if (!targets.has(targetComponent)) {
      targets.add(targetComponent);
      indegrees[targetComponent] = (indegrees[targetComponent] ?? 0) + 1;
    }
  }

  const componentOrder = (left: number, right: number) =>
    (components[left]?.key ?? left) - (components[right]?.key ?? right);
  const queue = components
    .map((_component, componentIndex) => componentIndex)
    .filter((componentIndex) => indegrees[componentIndex] === 0)
    .sort(componentOrder);
  const layerByComponent = components.map(() => 0);
  while (queue.length > 0) {
    const component = queue.shift();
    if (component === undefined) break;
    for (const target of [...(outgoing[component] ?? [])].sort(componentOrder)) {
      layerByComponent[target] = Math.max(
        layerByComponent[target] ?? 0,
        (layerByComponent[component] ?? 0) + 1,
      );
      indegrees[target] = (indegrees[target] ?? 0) - 1;
      if (indegrees[target] === 0) {
        queue.push(target);
        queue.sort(componentOrder);
      }
    }
  }
  for (let component = 0; component < components.length; component += 1) {
    const componentEntry = components[component];
    if (componentEntry !== undefined) componentEntry.layer = layerByComponent[component] ?? 0;
  }

  const layers: number[][] = [];
  const orderedComponents = components
    .map((_component, componentIndex) => componentIndex)
    .sort((left, right) => {
      const layerDifference = (layerByComponent[left] ?? 0) - (layerByComponent[right] ?? 0);
      return layerDifference === 0 ? componentOrder(left, right) : layerDifference;
    });
  for (const component of orderedComponents) {
    const layer = layerByComponent[component] ?? 0;
    layers[layer] = [...(layers[layer] ?? []), ...(components[component]?.members ?? [])];
    layers[layer] = [...(layers[layer] ?? []), ...(components[component]?.members ?? [])].sort(
      (left, right) => left - right,
    );
  }

  return { components, componentByNode, layers };
}

function createNetworkRows(
  details: NetworkChartDetails,
  layout: NetworkChartLayout,
  theme: ChartTheme,
): NetworkRows {
  const topology = computeNetworkTopology(details);
  const maxLayer = Math.max(0, topology.layers.length - 1);
  const horizontalSpan = Math.max(0, layout.plotWidthPx - NODE_RADIUS_PX * 2);
  const verticalSpan = Math.max(0, layout.plotHeightPx - NODE_RADIUS_PX * 2);
  const xStep = maxLayer === 0 ? 0 : horizontalSpan / maxLayer;
  const basePositions = new Map<string, { layer: number; x: number; y: number }>();
  for (let layer = 0; layer < topology.layers.length; layer += 1) {
    const nodeIndexes = topology.layers[layer] ?? [];
    const yStep = nodeIndexes.length <= 1 ? 0 : verticalSpan / (nodeIndexes.length - 1);
    for (let order = 0; order < nodeIndexes.length; order += 1) {
      const ordinal = nodeIndexes[order];
      const node = ordinal === undefined ? undefined : details.nodes[ordinal];
      if (ordinal === undefined || node === undefined) continue;
      const x = NODE_RADIUS_PX + layer * xStep;
      const y =
        nodeIndexes.length <= 1
          ? layout.plotHeightPx / 2
          : layout.plotHeightPx - NODE_RADIUS_PX - order * yStep;
      basePositions.set(node.id, { layer, x, y });
    }
  }
  const firstForwardTargetX = new Map<string, number>();
  for (const edge of details.edges) {
    const source = basePositions.get(edge.source);
    const target = basePositions.get(edge.target);
    if (source === undefined || target === undefined || target.layer <= source.layer) continue;
    const current = firstForwardTargetX.get(edge.source);
    if (current === undefined || target.x < current) firstForwardTargetX.set(edge.source, target.x);
  }

  const groupIndexes = new Map<string, number>();
  for (const node of details.nodes) {
    if (node.group !== undefined && !groupIndexes.has(node.group)) {
      groupIndexes.set(node.group, groupIndexes.size);
    }
  }
  const colors = getChartColors(theme);
  const nodes = details.nodes.map((node, ordinal) => {
    const position = basePositions.get(node.id);
    if (position === undefined) throw new Error("network node position is missing");
    const component = topology.componentByNode[ordinal] ?? 0;
    const colorIndex = node.group === undefined ? 0 : (groupIndexes.get(node.group) ?? 0) + 1;
    const nextTargetX = firstForwardTargetX.get(node.id);
    const availableLabelWidth =
      nextTargetX === undefined
        ? layout.labelWidthPx
        : Math.max(8, nextTargetX - position.x - LABEL_OFFSET_PX - LABEL_EDGE_GAP_PX);
    return {
      ...node,
      ordinal,
      component,
      layer: position.layer,
      x: position.x,
      y: position.y,
      displayLabel: fitTextToWidth(
        node.label,
        Math.min(layout.labelWidthPx, availableLabelWidth),
        layout.fontSizePx,
      ),
      color: colors[colorIndex % Math.max(1, colors.length)] ?? "#579aca",
    };
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const positionedEdges = details.edges
    .map((edge, ordinal) => {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      if (sourceNode === undefined || targetNode === undefined) {
        throw new Error("network edge position is missing");
      }
      const kind: PositionedNetworkEdge["kind"] =
        sourceNode.id === targetNode.id
          ? "self"
          : sourceNode.layer < targetNode.layer
            ? "forward"
            : sourceNode.layer > targetNode.layer
              ? "backward"
              : "same-layer";
      const nextTargetX = firstForwardTargetX.get(sourceNode.id);
      return {
        ...edge,
        ordinal,
        sourceNode,
        targetNode,
        x1:
          kind === "forward" && nextTargetX !== undefined
            ? Math.min(
                sourceNode.x +
                  LABEL_OFFSET_PX +
                  estimateTextWidthPx(sourceNode.displayLabel, layout.fontSizePx) +
                  LABEL_EDGE_GAP_PX,
                targetNode.x - TARGET_EDGE_GAP_PX,
              )
            : sourceNode.x,
        y1: sourceNode.y,
        x2: targetNode.x,
        y2: targetNode.y,
        kind,
        bendPx: 0,
      } satisfies PositionedNetworkEdge;
    })
    .sort(
      (left, right) =>
        left.sourceNode.ordinal - right.sourceNode.ordinal ||
        left.targetNode.ordinal - right.targetNode.ordinal ||
        left.ordinal - right.ordinal,
    );
  const pairBends = new Map<string, number>();
  const edges = positionedEdges.map((edge) => {
    const pair = [edge.sourceNode.ordinal, edge.targetNode.ordinal]
      .sort((left, right) => left - right)
      .join(":");
    const pairIndex = pairBends.get(pair) ?? 0;
    pairBends.set(pair, pairIndex + 1);
    const bendPx = MANUAL_EDGE_BEND_PX + pairIndex * 8;
    return {
      ...edge,
      bendPx: edge.kind === "same-layer" && edge.x1 < bendPx ? -bendPx : bendPx,
    };
  });
  return {
    nodes,
    forwardEdges: edges.filter((edge) => edge.kind === "forward"),
    manualEdges: edges.filter((edge) => edge.kind !== "forward"),
  };
}

function createNetworkScales(layout: NetworkChartLayout) {
  return {
    x: { scale: scaleLinear().domain([0, layout.plotWidthPx]), axis: false as const },
    y: { scale: scaleLinear().domain([0, layout.plotHeightPx]), axis: false as const },
  };
}

function createNetworkDotMarks(nodes: readonly PositionedNetworkNode[]) {
  const nodesByColor = new Map<string, PositionedNetworkNode[]>();
  for (const node of nodes) {
    const group = nodesByColor.get(node.color) ?? [];
    group.push(node);
    nodesByColor.set(node.color, group);
  }
  return [...nodesByColor].map(([color, group]) =>
    dot(group, { x: "x", y: "y", key: "id", fill: color, r: NODE_RADIUS_PX }),
  );
}

function createNetworkSceneFromRows(
  rows: NetworkRows,
  theme: ChartTheme,
  layout: NetworkChartLayout,
  includeLinks: boolean,
  includeNodes: boolean,
) {
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const scales = createNetworkScales(layout);
  if (includeLinks && includeNodes) {
    return createChartScene(
      defineChart({
        marks: [
          link(rows.forwardEdges, {
            x1: "x1",
            y1: "y1",
            x2: "x2",
            y2: "y2",
            key: "ordinal",
            stroke: foreground,
            strokeOpacity: 0.8,
            strokeWidth: 1.5,
          }),
          ...createNetworkDotMarks(rows.nodes),
          text(rows.nodes, {
            x: "x",
            y: "y",
            text: "displayLabel",
            key: "id",
            fill: foreground,
            fontSize: layout.fontSizePx,
            anchor: "start",
            dx: LABEL_OFFSET_PX,
          }),
        ],
        scales,
        guides: false,
        margin: 0,
        focus: false,
        pointer: false,
      }),
      { width: layout.plotWidthPx, height: layout.plotHeightPx },
    );
  }
  if (includeLinks) {
    return createChartScene(
      defineChart({
        marks: [
          link(rows.forwardEdges, {
            x1: "x1",
            y1: "y1",
            x2: "x2",
            y2: "y2",
            key: "ordinal",
            stroke: foreground,
            strokeOpacity: 0.8,
            strokeWidth: 1.5,
          }),
        ],
        scales,
        guides: false,
        margin: 0,
        focus: false,
        pointer: false,
      }),
      { width: layout.plotWidthPx, height: layout.plotHeightPx },
    );
  }
  return createChartScene(
    defineChart({
      marks: [
        ...createNetworkDotMarks(rows.nodes),
        text(rows.nodes, {
          x: "x",
          y: "y",
          text: "displayLabel",
          key: "id",
          fill: foreground,
          fontSize: layout.fontSizePx,
          anchor: "start",
          dx: LABEL_OFFSET_PX,
        }),
      ],
      scales,
      guides: false,
      margin: 0,
      focus: false,
      pointer: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
}

function renderManualEdges(
  edges: readonly PositionedNetworkEdge[],
  foreground: string,
  plotHeightPx: number,
  plotWidthPx: number,
): string {
  return edges
    .map((edge) => {
      const y1 = plotHeightPx - edge.y1;
      const y2 = plotHeightPx - edge.y2;
      const dash =
        edge.kind === "same-layer" || edge.kind === "self" ? ` stroke-dasharray="4 3"` : "";
      if (edge.kind === "self") {
        const side = edge.x1 <= plotWidthPx / 2 ? 1 : -1;
        const above = y1 > 32;
        const direction = above ? -1 : 1;
        return `<path d="M ${edge.x1} ${y1} C ${edge.x1 + side * 22} ${y1 + direction * 24}, ${edge.x1 + side * 22} ${y1 + direction * 24}, ${edge.x1 + side * 6} ${y1 + direction * 6}" fill="none" stroke="${foreground}" stroke-opacity="0.8" stroke-width="1.5" stroke-linecap="round"${dash} marker-end="url(#pi-network-arrow)"/>`;
      }
      if (edge.kind === "same-layer") {
        const bendX = edge.x1 - edge.bendPx;
        return `<path d="M ${edge.x1} ${y1} C ${bendX} ${y1}, ${bendX} ${y2}, ${edge.x2} ${y2}" fill="none" stroke="${foreground}" stroke-opacity="0.8" stroke-width="1.5" stroke-linecap="round"${dash} marker-end="url(#pi-network-arrow)"/>`;
      }
      return `<path d="M ${edge.x1} ${y1} L ${edge.x2} ${y2}" fill="none" stroke="${foreground}" stroke-opacity="0.8" stroke-width="1.5" stroke-linecap="round" marker-end="url(#pi-network-arrow)"/>`;
    })
    .join("");
}

function renderNetworkEdgeLabels(
  edges: readonly PositionedNetworkEdge[],
  foreground: string,
  fontSizePx: number,
  plotHeightPx: number,
  plotWidthPx: number,
  edgeLabelLimit: number,
): string {
  const size = Math.max(8, Math.round(fontSizePx * 0.85));
  let labelsRendered = 0;
  return edges
    .flatMap((edge) => {
      if (edge.label === undefined || labelsRendered >= edgeLabelLimit) return [];
      labelsRendered += 1;
      const y1 = plotHeightPx - edge.y1;
      const y2 = plotHeightPx - edge.y2;
      const above = y1 > 32;
      const direction = above ? -1 : 1;
      const routeX = edge.x1 - edge.bendPx;
      const x =
        edge.kind === "self"
          ? edge.x1
          : edge.kind === "same-layer"
            ? routeX
            : (edge.x1 + edge.x2) / 2;
      const y = edge.kind === "self" ? y1 + direction * 27 : (y1 + y2) / 2 - 4;
      const availableWidth =
        edge.kind === "self"
          ? Math.min(
              120,
              Math.max(
                0,
                (edge.x1 <= plotWidthPx / 2 ? plotWidthPx - edge.x1 : edge.x1) -
                  SELF_LOOP_LABEL_MARGIN_PX * 2,
              ),
            )
          : edge.kind === "same-layer"
            ? Math.min(
                120,
                Math.max(
                  0,
                  2 * Math.min(routeX, plotWidthPx - routeX) - SELF_LOOP_LABEL_MARGIN_PX * 2,
                ),
              )
            : Math.min(120, Math.max(0, Math.abs(edge.x2 - edge.x1) - 12));
      if (availableWidth < size * ESTIMATED_CHARACTER_WIDTH) return [];
      const label = fitTextToWidth(edge.label, availableWidth, size);
      const labelWidth = estimateTextWidthPx(label, size);
      const labelX =
        edge.kind === "self"
          ? edge.x1 +
            (edge.x1 <= plotWidthPx / 2 ? 1 : -1) * (SELF_LOOP_LABEL_MARGIN_PX + labelWidth / 2)
          : x;
      return [
        `<text x="${labelX}" y="${y}" fill="${foreground}" font-size="${size}" text-anchor="middle">${escapeXml(label)}</text>`,
      ];
    })
    .join("");
}
export function getNetworkChartLayout(
  details: NetworkChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): NetworkChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.max(1, Math.round(width * cells.widthPx));
  const paddingPx = Math.max(8, Math.round(cells.widthPx * 1.25));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const titleHeightPx = details.title === undefined ? 0 : fontSizePx + paddingPx;
  const rowHeightPx = Math.max(Math.round(cells.heightPx * 1.25), fontSizePx + 7);
  const topology = computeNetworkTopology(details);
  const maxBreadth = Math.max(1, ...topology.layers.map((layer) => layer.length));
  // Expand broad layers instead of compressing nodes into overlapping labels. The node bound keeps this finite.
  const naturalPlotHeightPx = Math.max(rowHeightPx * 2, maxBreadth * rowHeightPx);
  const maxHeightPx = getChartHeightLimitPx(
    details.maxHeightCells,
    cells.heightPx,
    Number.POSITIVE_INFINITY,
  );
  const maxPlotHeightPx = Math.max(1, maxHeightPx - paddingPx * 2 - titleHeightPx);
  // Pack broad layers into the requested bound; node positions remain ordered and inside the viewport.
  const plotHeightPx = Math.min(naturalPlotHeightPx, maxPlotHeightPx);
  const compacted = plotHeightPx < naturalPlotHeightPx;
  const edgeLabelSizePx = Math.max(8, Math.round(fontSizePx * 0.85));
  const edgeLabelLimit = compacted
    ? Math.max(1, Math.floor(plotHeightPx / (edgeLabelSizePx * 1.5)))
    : details.edges.length;
  const minimumLabelWidthPx = Math.round(cells.widthPx * 8);
  const labelWidthPx = Math.min(
    Math.round(widthPx * 0.4),
    Math.max(
      minimumLabelWidthPx,
      ...details.nodes.map((node) => Math.ceil(estimateTextWidthPx(node.label, fontSizePx)) + 8),
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
      edgeLabelLimit,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

export function getNetworkChartSummary(details: NetworkChartDetails): string {
  const nodes = details.nodes
    .map(
      (node) =>
        `${node.label} [${node.id}${node.group === undefined ? "" : ` group=${node.group}`}]`,
    )
    .join("; ");
  const edges = details.edges
    .map(
      (edge) =>
        `${edge.source} -> ${edge.target}${edge.label === undefined ? "" : ` (${edge.label})`}`,
    )
    .join("; ");
  return `${details.title === undefined ? "Network chart" : `${details.title} network chart`}: nodes: ${nodes}; edges: ${edges || "none"}`;
}

export function createNetworkScene(
  details: NetworkChartDetails,
  theme?: ChartTheme,
  layout = getNetworkChartLayout(details),
) {
  const resolvedTheme = theme ?? { getFgAnsi: () => "" };
  const rows = createNetworkRows(details, layout, resolvedTheme);
  return createNetworkSceneFromRows(rows, resolvedTheme, layout, true, true);
}

export function renderNetworkChartSvg(
  details: NetworkChartDetails,
  theme: ChartTheme,
  layout = getNetworkChartLayout(details),
): string {
  const rows = createNetworkRows(details, layout, theme);
  const chartLabel =
    details.title === undefined ? "Network chart" : `Network chart: ${details.title}`;
  const renderBody = (includeLinks: boolean, includeNodes: boolean): string =>
    stripTanStackSvg(
      renderTanStackChartSvg(
        createNetworkSceneFromRows(rows, theme, layout, includeLinks, includeNodes),
        { ariaLabel: chartLabel, idPrefix: "pi-network" },
      ),
    )
      .replace(/ data-ts-key="[^"]*"/g, "")
      .replace(/<line\b/g, '<line marker-end="url(#pi-network-arrow)"');
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  // Keep scene-rendered forward lines separate so manual routed edges can carry arrowheads and labels.
  const linkBody = rows.forwardEdges.length === 0 ? "" : renderBody(true, false);
  const nodeBody = renderBody(false, true);
  const chartBody = `${linkBody}${renderManualEdges(
    rows.manualEdges,
    foreground,
    layout.plotHeightPx,
    layout.plotWidthPx,
  )}${renderNetworkEdgeLabels(
    [...rows.forwardEdges, ...rows.manualEdges],
    foreground,
    layout.fontSizePx,
    layout.plotHeightPx,
    layout.plotWidthPx,
    layout.edgeLabelLimit,
  )}${nodeBody}`;
  const summary = getNetworkChartSummary(details);
  const accessibleDescription = getAccessibleDescription(
    summary,
    `Network chart with ${details.nodes.length} nodes and ${details.edges.length} directed edges. The accompanying text result contains the exact graph.`,
  );
  const title =
    details.title === undefined
      ? ""
      : `<text x="${layout.plotX}" y="${layout.plotY - Math.round(layout.fontSizePx * 0.55)}" fill="${foreground}" font-family="${escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY)}" font-size="${layout.fontSizePx}">${escapeXml(details.title)}</text>`;
  const marker = `<defs><marker id="pi-network-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 6 3 L 0 6 z" fill="${foreground}"/></marker></defs>`;
  const accessibleName =
    details.title === undefined ? "Network chart" : `Network chart: ${details.title}`;
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: details.fontFamily ?? DEFAULT_FONT_FAMILY,
    ariaLabel: accessibleName,
    ariaDescription: accessibleDescription,
    content: `${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}${marker}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}</g>${title}`,
  });
}

export const networkChartRenderer: ChartType<
  typeof networkChartVariant,
  NetworkChartData,
  NetworkChartDetails,
  NetworkChartLayout
> = {
  renderingText: "Rendering network chart…",
  unavailableText: "Network chart unavailable",
  parameters: networkChartVariant,
  parseParameters: validateNetworkChartInput,
  createDetails(data, settings) {
    return {
      type: "network",
      ...data,
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
      ...(data.maxHeightCells === undefined ? {} : { maxHeightCells: data.maxHeightCells }),
    };
  },
  getCallHeader: (parameters) => {
    const count = Array.isArray(parameters.nodes) ? parameters.nodes.length : 0;
    return `network (${count} nodes)`;
  },
  getSummary: getNetworkChartSummary,
  getLayout: getNetworkChartLayout,
  renderSvg: renderNetworkChartSvg,
  deserializeDetails: deserializeNetworkChartDetails,
};
