import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  rect,
  renderChartSvg as renderTanStackChartSvg,
  text,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  type GanttChartInput,
  ganttChartVariant,
  MAX_GANTT_GROUP_LENGTH,
  MAX_GANTT_ID_LENGTH,
  MAX_GANTT_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
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
  getChartHeightLimitPx,
  ESTIMATED_CHARACTER_WIDTH,
  estimateTextWidthPx,
  finalizeChartLayout,
  formatNumber,
  getAccessibleDescription,
  isValidChartHeight,
  normalizeBoundedText,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { GanttChartInput };
export { ganttChartVariant };

export type GanttTask = {
  id: string;
  label: string;
  start: number;
  end: number;
  group?: string;
  progress: number;
  dependencies: string[];
};

export type GanttMilestone = {
  label: string;
  at: number;
};

export type GanttChartData = {
  tasks: GanttTask[];
  milestones: GanttMilestone[];
  title?: string;
  xLabel?: string;
  maxHeightCells?: number;
};

export type GanttChartDetails = ChartDetails &
  GanttChartData & {
    type: "gantt";
  };

export type GanttChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  rowHeightPx: number;
  labelWidthPx: number;
  fontSizePx: number;
  titleHeightPx: number;
  tickHeightPx: number;
  annotationHeightPx: number;
  legendHeightPx: number;
  legendEntryLimit: number;
};

type PositionedGanttTask = GanttTask & {
  index: number;
  x1: number;
  x2: number;
  progressEnd: number;
  y1: number;
  y2: number;
  y: number;
  progressLabel: string;
  color: string;
};

type LegendEntry = {
  label: string;
  group?: string;
  kind: "group" | "dependency";
};

const MIN_TIME_SPAN = Number.EPSILON;
const LEGEND_GAP_PX = 18;
const LEGEND_SWATCH_PX = 8;
const DEPENDENCY_ROUTE_GAP_PX = 12;
const MILESTONE_SIZE_PX = 7;
const MILESTONE_GAP_PX = 8;

function normalizeId(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_GANTT_ID_LENGTH)
    throw new Error(`${name} must be 1-${MAX_GANTT_ID_LENGTH} characters`);
  return normalized;
}

function normalizeLabel(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_GANTT_LABEL_LENGTH)
    throw new Error(`${name} must be 1-${MAX_GANTT_LABEL_LENGTH} characters`);
  return normalized;
}

function normalizeGanttChartInput(input: GanttChartInput): GanttChartData {
  if (input.maxHeightCells !== undefined && !isValidChartHeight(input.maxHeightCells))
    throw new Error("invalid chart height");

  const tasks = input.tasks.map((task, index) => {
    const id = normalizeId(task.id, `task ${index + 1} id`);
    const label = normalizeLabel(task.label, `task ${index + 1} label`);
    const group = normalizeBoundedText(
      task.group,
      `task ${index + 1} group`,
      MAX_GANTT_GROUP_LENGTH,
    );
    if (!Number.isFinite(task.start) || !Number.isFinite(task.end) || task.start >= task.end)
      throw new Error(`task ${index + 1} must have finite start < end`);
    const progress = task.progress ?? 0;
    if (!Number.isFinite(progress) || progress < 0 || progress > 1)
      throw new Error(`task ${index + 1} progress must be between 0 and 1`);
    const dependencies = (task.dependencies ?? []).map((dependency, dependencyIndex) =>
      normalizeId(dependency, `task ${index + 1} dependency ${dependencyIndex + 1}`),
    );
    if (new Set(dependencies).size !== dependencies.length)
      throw new Error(`task ${index + 1} dependencies must be unique`);
    if (dependencies.includes(id)) throw new Error(`task ${id} cannot depend on itself`);
    return {
      id,
      label,
      start: task.start,
      end: task.end,
      progress,
      dependencies,
      ...(group === undefined ? {} : { group }),
    } satisfies GanttTask;
  });

  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    throw new Error("task IDs must be unique after trimming");
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency))
        throw new Error(`task ${task.id} dependency ${dependency} does not reference a task`);
    }
  }

  const milestones = (input.milestones ?? []).map((milestone, index) => {
    const label = normalizeLabel(milestone.label, `milestone ${index + 1} label`);
    if (!Number.isFinite(milestone.at)) throw new Error(`milestone ${index + 1} must be finite`);
    return { label, at: milestone.at } satisfies GanttMilestone;
  });
  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  const xLabel = normalizeBoundedText(input.xLabel, "xLabel", 40);
  return {
    tasks,
    milestones,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

export function validateGanttChartInput(input: GanttChartInput): GanttChartData {
  if (!Value.Check(ganttChartVariant, input)) throw new Error("invalid gantt chart parameters");
  return normalizeGanttChartInput(input);
}

const detailsSchema = Type.Object(
  {
    ...ganttChartVariant.properties,
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeGanttChartDetails(value: unknown): GanttChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => normalizeGanttChartInput(input as GanttChartInput),
    (data, settings) => ({ type: "gantt", ...data, ...settings }),
  );
}

export function getGanttDomain(details: GanttChartData): [number, number] {
  const values = [
    ...details.tasks.flatMap((task) => [task.start, task.end]),
    ...details.milestones.map((milestone) => milestone.at),
  ];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return maximum - minimum < MIN_TIME_SPAN ? [minimum, minimum + 1] : [minimum, maximum];
}

export function getGanttChartSummary(details: GanttChartDetails): string {
  const tasks = details.tasks
    .map((task) => {
      const group = task.group === undefined ? "" : `, group=${task.group}`;
      const dependencies = task.dependencies.length === 0 ? "none" : task.dependencies.join(",");
      return `${task.label} [${task.id}] ${task.start}-${task.end} progress=${task.progress}${group}, dependencies=${dependencies}`;
    })
    .join("; ");
  const milestones =
    details.milestones.length === 0
      ? "none"
      : details.milestones.map((milestone) => `${milestone.label} @ ${milestone.at}`).join("; ");
  return `${details.title ?? "Gantt chart"}${details.xLabel === undefined ? "" : `; X: ${details.xLabel}`}: tasks: ${tasks}; milestones: ${milestones}`;
}

function getLegendEntries(details: GanttChartData): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const groups = new Set<string | undefined>();
  for (const task of details.tasks) groups.add(task.group);
  for (const group of groups)
    entries.push({
      label: group ?? "ungrouped",
      ...(group === undefined ? {} : { group }),
      kind: "group",
    });
  entries.push({ label: "dependency", kind: "dependency" });
  return entries;
}

function getLegendRowCount(
  entries: readonly LegendEntry[],
  widthPx: number,
  fontSizePx: number,
): number {
  if (entries.length === 0) return 0;
  const availableWidth = Math.max(1, widthPx);
  let rows = 1;
  let used = 0;
  for (const entry of entries) {
    const entryWidth =
      estimateTextWidthPx(entry.label, fontSizePx) +
      (entry.kind === "dependency" ? 58 : LEGEND_SWATCH_PX + 28);
    if (used > 0 && used + entryWidth > availableWidth) {
      rows += 1;
      used = entryWidth;
    } else {
      used += entryWidth + LEGEND_GAP_PX;
    }
  }
  return rows;
}

function getLegendEntriesForRows(
  entries: readonly LegendEntry[],
  widthPx: number,
  fontSizePx: number,
  maximumRows: number,
): LegendEntry[] {
  if (maximumRows <= 0) return [];
  const availableWidth = Math.max(1, widthPx);
  let rows = 1;
  let used = 0;
  const visible: LegendEntry[] = [];
  for (const entry of entries) {
    const entryWidth =
      estimateTextWidthPx(entry.label, fontSizePx) +
      (entry.kind === "dependency" ? 58 : LEGEND_SWATCH_PX + 28);
    if (used > 0 && used + entryWidth > availableWidth) {
      rows += 1;
      used = 0;
    }
    if (rows > maximumRows) break;
    visible.push(entry);
    used += entryWidth + LEGEND_GAP_PX;
  }
  return visible;
}

export function getGanttChartLayout(
  details: GanttChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): GanttChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const requestedWidthPx = Math.max(1, Math.round(width * cells.widthPx));
  const paddingPx = Math.max(8, Math.round(cells.widthPx * 1.25));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const titleHeightPx = details.title === undefined ? 0 : fontSizePx + paddingPx;
  const tickHeightPx = Math.ceil(fontSizePx * 1.5);
  const baseRowHeightPx = Math.max(Math.round(cells.heightPx * 1.4), Math.ceil(fontSizePx * 1.8));
  const labelWidthPx = Math.min(
    Math.round(requestedWidthPx * 0.42),
    Math.max(
      Math.round(cells.widthPx * 12),
      ...details.tasks.map((task) => Math.ceil(estimateTextWidthPx(task.label, fontSizePx)) + 12),
    ),
  );
  const plotX = paddingPx + labelWidthPx;
  const minimumPlotWidthPx = Math.round(cells.widthPx * 16);
  const plotWidthPx = Math.max(minimumPlotWidthPx, requestedWidthPx - plotX - paddingPx);
  const widthPx = Math.max(requestedWidthPx, plotX + plotWidthPx + paddingPx);
  const naturalPlotHeightPx = Math.max(baseRowHeightPx * 2, details.tasks.length * baseRowHeightPx);
  const annotationHeightPx = Math.max(
    fontSizePx * 2.4,
    details.xLabel === undefined ? 0 : fontSizePx * 3.2,
    details.milestones.length === 0 ? 0 : fontSizePx * 2.8,
  );
  const legendEntries = getLegendEntries(details);
  const legendRowHeightPx = Math.ceil(fontSizePx * 1.7);
  const legendWidthPx = widthPx - plotX;
  const fullLegendRows = getLegendRowCount(legendEntries, legendWidthPx, fontSizePx);
  const fixedWithoutLegendPx = paddingPx + titleHeightPx + tickHeightPx + annotationHeightPx;
  const heightLimitPx =
    details.maxHeightCells === undefined
      ? Number.POSITIVE_INFINITY
      : getChartHeightLimitPx(details.maxHeightCells, cells.heightPx, undefined);
  const maximumLegendRows = Number.isFinite(heightLimitPx)
    ? Math.max(
        0,
        Math.floor(
          Math.max(0, heightLimitPx - fixedWithoutLegendPx - 1 - paddingPx) / legendRowHeightPx,
        ),
      )
    : fullLegendRows;
  const visibleLegendEntries = getLegendEntriesForRows(
    legendEntries,
    legendWidthPx,
    fontSizePx,
    maximumLegendRows,
  );
  const legendEntryLimit = visibleLegendEntries.length;
  const legendHeightPx =
    legendEntryLimit === 0
      ? 0
      : getLegendRowCount(visibleLegendEntries, legendWidthPx, fontSizePx) * legendRowHeightPx +
        paddingPx;
  const fixedHeightPx = fixedWithoutLegendPx + legendHeightPx;
  const plotHeightPx = Math.max(
    1,
    details.maxHeightCells === undefined
      ? naturalPlotHeightPx
      : Math.min(naturalPlotHeightPx, Math.max(1, heightLimitPx - fixedHeightPx)),
  );
  // Use the actual pitch after height compaction so overlays share TanStack's row coordinates.
  const rowHeightPx = plotHeightPx / details.tasks.length;
  const heightPx = Math.ceil(fixedHeightPx + plotHeightPx);
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX,
      plotY: paddingPx + titleHeightPx + tickHeightPx,
      plotWidthPx,
      plotHeightPx,
      rowHeightPx,
      labelWidthPx,
      titleHeightPx,
      tickHeightPx,
      fontSizePx,
      annotationHeightPx,
      legendHeightPx,
      legendEntryLimit,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

function getGanttColors(
  details: GanttChartData,
  theme: ChartTheme,
): Map<string | undefined, string> {
  const colors = getChartColors(theme);
  const groups = new Map<string | undefined, string>();
  for (const task of details.tasks) {
    if (groups.has(task.group)) continue;
    const colorIndex = groups.size;
    groups.set(task.group, colors[colorIndex % Math.max(1, colors.length)] ?? "#579aca");
  }
  return groups;
}

function createGanttRows(details: GanttChartDetails, theme: ChartTheme): PositionedGanttTask[] {
  const [minimum, maximum] = getGanttDomain(details);
  const span = Math.max(maximum - minimum, MIN_TIME_SPAN);
  const position = (value: number) => (value - minimum) / span;
  const colors = getGanttColors(details, theme);
  return details.tasks.map((task, index) => {
    const x1 = position(task.start);
    const x2 = position(task.end);
    return {
      ...task,
      index,
      x1,
      x2,
      progressEnd: x1 + (x2 - x1) * task.progress,
      y1: details.tasks.length - index - 0.82,
      y2: details.tasks.length - index - 0.18,
      y: details.tasks.length - index - 0.5,
      progressLabel: `${Math.round(task.progress * 100)}%`,
      color: colors.get(task.group) ?? "#579aca",
    };
  });
}

function createGanttScene(rows: readonly PositionedGanttTask[], layout: GanttChartLayout) {
  const groups = [...new Set(rows.map((row) => row.group))];
  const progressFillRows = rows.filter((row) => row.progress > 0);
  const progressLabelRows = rows.filter(
    (row) =>
      layout.rowHeightPx >= layout.fontSizePx * 1.35 &&
      (row.x2 - row.x1) * layout.plotWidthPx >= layout.fontSizePx * 2.5,
  );
  return createChartScene(
    defineChart({
      marks: [
        ...groups.map((group) => {
          const groupRows = rows.filter((row) => row.group === group);
          return rect(groupRows, {
            x1: "x1",
            x2: "x2",
            y1: "y1",
            y2: "y2",
            key: (row) => `background-${row.id}`,
            fill: groupRows[0]?.color ?? "#579aca",
            fillOpacity: 0.2,
            stroke: groupRows[0]?.color ?? "#579aca",
            strokeWidth: 1.5,
            inset: 0,
          });
        }),
        ...groups.map((group) => {
          const groupRows = progressFillRows.filter((row) => row.group === group);
          return rect(groupRows, {
            x1: "x1",
            x2: "progressEnd",
            y1: "y1",
            y2: "y2",
            key: (row) => `progress-${row.id}`,
            fill: groupRows[0]?.color ?? "#579aca",
            fillOpacity: 0.82,
            inset: 0,
          });
        }),
        text(progressLabelRows, {
          x: (row) => row.x1 + Math.min(0.02, (row.x2 - row.x1) * 0.15),
          y: "y",
          text: "progressLabel",
          key: (row) => `progress-label-${row.id}`,
          fill: "#071018",
          fontSize: layout.fontSizePx,
          anchor: "start",
        }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, rows.length]), axis: false },
      },
      guides: false,
      margin: 0,
      focus: false,
      pointer: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
}

function fitLabel(value: string, maximumWidthPx: number, fontSizePx: number): string {
  const maxCharacters = Math.floor(
    Math.max(0, maximumWidthPx - 8) / (fontSizePx * ESTIMATED_CHARACTER_WIDTH),
  );
  if (maxCharacters <= 0) return "";
  if (Array.from(value).length <= maxCharacters) return value;
  if (maxCharacters === 1) return "…";
  return `${Array.from(value)
    .slice(0, maxCharacters - 1)
    .join("")}…`;
}

function renderText(
  value: string,
  x: number,
  y: number,
  fontSizePx: number,
  fontFamily: string,
  foreground: string,
  anchor = "middle",
  extra = "",
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${fontSizePx}" ${extra}>${escapeXml(value)}</text>`;
}

function renderGrid(
  details: GanttChartDetails,
  layout: GanttChartLayout,
  foreground: string,
): string {
  const [minimum, maximum] = getGanttDomain(details);
  const span = Math.max(maximum - minimum, MIN_TIME_SPAN);
  const tickCount = Math.min(
    8,
    Math.max(2, Math.floor(layout.plotWidthPx / (layout.fontSizePx * 9))),
  );
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const ratio = tickCount === 1 ? 0.5 : index / (tickCount - 1);
    const x = layout.plotX + ratio * layout.plotWidthPx;
    const value = minimum + ratio * span;
    return `<line x1="${x}" y1="${layout.plotY}" x2="${x}" y2="${layout.plotY + layout.plotHeightPx}" stroke="${foreground}" stroke-opacity="0.16"/><text x="${x}" y="${layout.plotY - 8}" text-anchor="middle" fill="${foreground}" font-size="${layout.fontSizePx * 0.82}">${escapeXml(formatNumber(value))}</text>`;
  }).join("");
  const rows = details.tasks
    .map((_, index) => {
      const y = layout.plotY + index * layout.rowHeightPx;
      return `<line x1="${layout.plotX}" y1="${y}" x2="${layout.plotX + layout.plotWidthPx}" y2="${y}" stroke="${foreground}" stroke-opacity="0.08"/>`;
    })
    .join("");
  return `${ticks}${rows}`;
}

function renderTaskLabels(
  details: GanttChartDetails,
  layout: GanttChartLayout,
  foreground: string,
): string {
  const labelFontSize = Math.min(
    layout.fontSizePx,
    Math.max(MIN_FONT_SIZE_PX, layout.rowHeightPx * 0.72),
  );
  // Below this pitch, labels would be closer than a readable glyph height; bars and the exact summary remain.
  if (layout.rowHeightPx < MIN_FONT_SIZE_PX / 0.72) return "";
  const showGroups = layout.rowHeightPx >= layout.fontSizePx * 1.7;
  return details.tasks
    .map((task, index) => {
      const centerY = layout.plotY + (index + 0.5) * layout.rowHeightPx;
      const label = fitLabel(task.label, layout.labelWidthPx - 8, labelFontSize);
      const group = task.group ?? "ungrouped";
      return `${renderText(label, layout.plotX - 8, centerY + labelFontSize * 0.35, labelFontSize, details.fontFamily ?? DEFAULT_FONT_FAMILY, foreground, "end")}${showGroups ? renderText(group, layout.plotX - 8, centerY + layout.fontSizePx * 0.95, Math.max(8, layout.fontSizePx * 0.72), details.fontFamily ?? DEFAULT_FONT_FAMILY, foreground, "end") : ""}`;
    })
    .join("");
}

function renderDependencies(
  rows: readonly PositionedGanttTask[],
  layout: GanttChartLayout,
): string {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return rows
    .flatMap((target) =>
      target.dependencies.flatMap((dependency) => {
        const source = rowsById.get(dependency);
        if (source === undefined) return [];
        const x1 = layout.plotX + source.x2 * layout.plotWidthPx;
        const x2 = layout.plotX + target.x1 * layout.plotWidthPx;
        const y1 = layout.plotY + (source.index + 0.5) * layout.rowHeightPx;
        const y2 = layout.plotY + (target.index + 0.5) * layout.rowHeightPx;
        const mid =
          x2 >= x1
            ? (x1 + x2) / 2
            : Math.min(layout.plotX + layout.plotWidthPx, x1 + DEPENDENCY_ROUTE_GAP_PX);
        return [
          `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" class="pi-gantt-dependency" marker-end="url(#pi-gantt-arrow)"/>`,
        ];
      }),
    )
    .join("");
}

function renderMilestones(
  details: GanttChartDetails,
  layout: GanttChartLayout,
  fontFamily: string,
): string {
  const [minimum, maximum] = getGanttDomain(details);
  const span = Math.max(maximum - minimum, MIN_TIME_SPAN);
  const diamondY = layout.plotY + layout.plotHeightPx + MILESTONE_GAP_PX;
  return details.milestones
    .map((milestone) => {
      const x = layout.plotX + ((milestone.at - minimum) / span) * layout.plotWidthPx;
      const label = fitLabel(
        milestone.label,
        Math.min(120, layout.plotWidthPx * 0.25),
        layout.fontSizePx * 0.82,
      );
      const anchor = x > layout.widthPx - 100 ? "end" : "start";
      const labelX = anchor === "end" ? x - MILESTONE_SIZE_PX - 6 : x + MILESTONE_SIZE_PX + 6;
      return `<line x1="${x}" y1="${layout.plotY}" x2="${x}" y2="${diamondY + MILESTONE_SIZE_PX}" stroke="#f0b85b" stroke-width="1.5" stroke-dasharray="5 4"/><path d="M ${x} ${diamondY - MILESTONE_SIZE_PX} l ${MILESTONE_SIZE_PX} ${MILESTONE_SIZE_PX} l -${MILESTONE_SIZE_PX} ${MILESTONE_SIZE_PX} l -${MILESTONE_SIZE_PX} -${MILESTONE_SIZE_PX} z" fill="#f0b85b"/>${renderText(label, labelX, diamondY + 4, Math.max(8, layout.fontSizePx * 0.82), fontFamily, "#f0b85b", anchor)}`;
    })
    .join("");
}

function renderLegend(
  details: GanttChartDetails,
  layout: GanttChartLayout,
  theme: ChartTheme,
  fontFamily: string,
  foreground: string,
): string {
  const entries = getLegendEntries(details).slice(0, layout.legendEntryLimit);
  const colors = getGanttColors(details, theme);
  const availableWidth = layout.widthPx - layout.plotX;
  const startY = layout.heightPx - layout.legendHeightPx + layout.fontSizePx;
  let x = layout.plotX;
  let y = startY;
  const rowHeight = Math.ceil(layout.fontSizePx * 1.7);
  const output: string[] = [];
  for (const entry of entries) {
    const entryWidth =
      estimateTextWidthPx(entry.label, layout.fontSizePx) +
      (entry.kind === "dependency" ? 58 : LEGEND_SWATCH_PX + 28);
    if (x > layout.plotX && x + entryWidth > layout.plotX + availableWidth) {
      x = layout.plotX;
      y += rowHeight;
    }
    if (entry.kind === "dependency") {
      output.push(
        `<line x1="${x}" y1="${y - 4}" x2="${x + 28}" y2="${y - 4}" class="pi-gantt-dependency" marker-end="url(#pi-gantt-arrow)"/>`,
      );
      output.push(
        renderText(
          entry.label,
          x + 38,
          y,
          Math.max(8, layout.fontSizePx * 0.82),
          fontFamily,
          foreground,
          "start",
        ),
      );
    } else {
      const color = colors.get(entry.group) ?? "#579aca";
      output.push(
        `<rect x="${x}" y="${y - LEGEND_SWATCH_PX}" width="${LEGEND_SWATCH_PX}" height="${LEGEND_SWATCH_PX}" rx="2" fill="${color}"/>`,
      );
      output.push(
        renderText(
          entry.label,
          x + LEGEND_SWATCH_PX + 8,
          y,
          Math.max(8, layout.fontSizePx * 0.82),
          fontFamily,
          foreground,
          "start",
        ),
      );
    }
    x += entryWidth + LEGEND_GAP_PX;
  }
  return output.join("");
}

export function renderGanttChartSvg(
  details: GanttChartDetails,
  theme: ChartTheme,
  layout = getGanttChartLayout(details),
): string {
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const fontFamily = details.fontFamily ?? DEFAULT_FONT_FAMILY;
  const rows = createGanttRows(details, theme);
  const plot = stripTanStackSvg(
    renderTanStackChartSvg(createGanttScene(rows, layout), {
      ariaLabel: details.title === undefined ? "Gantt chart" : `Gantt chart: ${details.title}`,
      idPrefix: "pi-gantt",
    }),
  );
  const summary = getGanttChartSummary(details);
  const accessibleDescription = getAccessibleDescription(
    summary,
    `Gantt chart with ${details.tasks.length} tasks and ${details.milestones.length} milestones. The accompanying text result contains the exact schedule.`,
  );
  const title =
    details.title === undefined
      ? ""
      : renderText(
          details.title,
          layout.plotX,
          layout.plotY - layout.tickHeightPx - layout.titleHeightPx + layout.fontSizePx,
          layout.fontSizePx,
          fontFamily,
          foreground,
          "start",
        );
  const xLabel =
    details.xLabel === undefined
      ? ""
      : renderText(
          fitLabel(details.xLabel, layout.plotWidthPx, layout.fontSizePx),
          layout.plotX + layout.plotWidthPx / 2,
          layout.plotY + layout.plotHeightPx + layout.fontSizePx * 2.4,
          Math.max(8, layout.fontSizePx * 0.82),
          fontFamily,
          foreground,
        );
  const style = `<style>.pi-gantt-dependency{fill:none;stroke:${foreground};stroke-opacity:.7;stroke-width:1.5;stroke-dasharray:4 3}</style>`;
  const marker = `<defs><marker id="pi-gantt-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="${foreground}"/></marker></defs>`;
  const name = details.title === undefined ? "Gantt chart" : `Gantt chart: ${details.title}`;
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: fontFamily,
    ariaLabel: name,
    ariaDescription: accessibleDescription,
    content: `${style}${marker}<title>${escapeXml(name)}</title>${renderGrid(details, layout, foreground)}${renderDependencies(rows, layout)}<g transform="translate(${layout.plotX} ${layout.plotY})">${plot}</g>${renderTaskLabels(details, layout, foreground)}${renderMilestones(details, layout, fontFamily)}${xLabel}${title}${renderLegend(details, layout, theme, fontFamily, foreground)}`,
  });
}

export const ganttChartRenderer: ChartType<
  typeof ganttChartVariant,
  GanttChartData,
  GanttChartDetails,
  GanttChartLayout
> = {
  renderingText: "Rendering Gantt chart…",
  unavailableText: "Gantt chart unavailable",
  parameters: ganttChartVariant,
  parseParameters: validateGanttChartInput,
  createDetails: (data, settings) => ({ type: "gantt", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getGanttChartSummary,
  getLayout: getGanttChartLayout,
  renderSvg: renderGanttChartSvg,
  deserializeDetails: deserializeGanttChartDetails,
};
