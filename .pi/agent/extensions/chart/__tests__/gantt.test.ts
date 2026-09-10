import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createGanttChartTool } from "../metadata";
import { chartGanttParameters } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  type GanttChartInput,
  ganttChartRenderer,
  ganttChartVariant,
  validateGanttChartInput,
} from "../types/gantt";

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

const input: GanttChartInput = {
  type: "gantt",
  title: "Repository analysis plan",
  xLabel: "Day",
  tasks: [
    { id: "scan", label: "Scan repository", start: 0, end: 3, group: "frontend", progress: 1 },
    {
      id: "ast",
      label: "Build AST index",
      start: 2,
      end: 6,
      group: "analysis",
      progress: 0.8,
      dependencies: ["scan"],
    },
    {
      id: "imports",
      label: "Resolve imports",
      start: 5,
      end: 9,
      group: "analysis",
      progress: 0.45,
      dependencies: ["ast"],
    },
    {
      id: "network",
      label: "Render call graph",
      start: 10,
      end: 14,
      group: "frontend",
      dependencies: ["imports"],
    },
  ],
  milestones: [{ label: "Release", at: 15 }],
};

const [scanTask, astTask] = input.tasks;
if (scanTask === undefined || astTask === undefined) throw new Error("invalid test fixture");

describe("gantt chart", () => {
  test("validates and normalizes ordered tasks, dependencies, and milestones", () => {
    expect(
      validateGanttChartInput({
        ...input,
        tasks: input.tasks.map((task) => ({
          ...task,
          id: ` ${task.id} `,
          label: ` ${task.label} `,
        })),
        milestones: [{ label: " Release ", at: 15 }],
      }),
    ).toEqual({
      title: "Repository analysis plan",
      xLabel: "Day",
      tasks: [
        {
          id: "scan",
          label: "Scan repository",
          start: 0,
          end: 3,
          group: "frontend",
          progress: 1,
          dependencies: [],
        },
        {
          id: "ast",
          label: "Build AST index",
          start: 2,
          end: 6,
          group: "analysis",
          progress: 0.8,
          dependencies: ["scan"],
        },
        {
          id: "imports",
          label: "Resolve imports",
          start: 5,
          end: 9,
          group: "analysis",
          progress: 0.45,
          dependencies: ["ast"],
        },
        {
          id: "network",
          label: "Render call graph",
          start: 10,
          end: 14,
          group: "frontend",
          progress: 0,
          dependencies: ["imports"],
        },
      ],
      milestones: [{ label: "Release", at: 15 }],
    });
    expect(Value.Check(chartGanttParameters, { tasks: input.tasks })).toBe(true);
    expect(Value.Check(chartGanttParameters, input)).toBe(false);
    expect(Value.Check(ganttChartVariant, input)).toBe(true);
  });

  test("rejects invalid intervals, duplicate IDs, dependencies, and text", () => {
    expect(() => validateGanttChartInput({ ...input, tasks: [{ ...scanTask, end: 0 }] })).toThrow(
      "start < end",
    );
    expect(() =>
      validateGanttChartInput({
        ...input,
        tasks: [scanTask, { ...astTask, id: " scan ", dependencies: [] }],
      }),
    ).toThrow("task IDs must be unique");
    expect(() =>
      validateGanttChartInput({
        ...input,
        tasks: [{ ...scanTask, dependencies: ["missing"] }],
      }),
    ).toThrow("does not reference a task");
    expect(() => validateGanttChartInput({ ...input, title: "   " })).toThrow("title");
  });

  test("renders TanStack interval marks, progress text, dependencies, milestones, and summary", () => {
    const details = ganttChartRenderer.createDetails(ganttChartRenderer.parseParameters(input), {
      imageWidthCells: 60,
      fontFamily: "sans-serif",
    });
    const layout = ganttChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = ganttChartRenderer.renderSvg(details, theme, layout);

    expect(svg).toContain('aria-label="Gantt chart: Repository analysis plan"');
    expect(svg).toContain("Build AST index");
    expect(svg).toContain("80%");
    expect(svg).toContain("Release");
    expect(svg).toContain('marker-end="url(#pi-gantt-arrow)"');
    expect(svg).toContain('class="pi-gantt-dependency"');
    expect(svg.match(/<rect /g)?.length).toBeGreaterThanOrEqual(8);
    expect(svg.match(/<text /g)?.length).toBeGreaterThan(8);
    expect(ganttChartRenderer.getSummary(details)).toContain("ast");
    expect(layout.plotWidthPx).toBeGreaterThan(0);
  });

  test("retains narrow progress fills and allocates wrapped legends and tick bands", () => {
    const narrowInput: GanttChartInput = {
      type: "gantt",
      tasks: Array.from({ length: 8 }, (_, index) => ({
        id: `task-${index}`,
        label: `Task ${index}`,
        start: index,
        end: index + 0.2,
        group: `group-${index}`,
        progress: index === 0 ? 1 : 0,
      })),
    };
    const details = ganttChartRenderer.createDetails(
      ganttChartRenderer.parseParameters(narrowInput),
      { imageWidthCells: 20, fontFamily: "sans-serif" },
    );
    const layout = ganttChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 20);
    const svg = ganttChartRenderer.renderSvg(details, theme, layout);
    expect(svg).toContain("progress-task-0");
    expect(svg).not.toContain("progress-label-task-0");
    for (let index = 0; index < 8; index += 1) expect(svg).toContain(`group-${index}`);
    const textY = Array.from(svg.matchAll(/<text\b[^>]*\by="([0-9.e+-]+)"/g), (match) =>
      Number(match[1]),
    );
    expect(Math.min(...textY)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...textY)).toBeLessThanOrEqual(layout.heightPx);
    expect(layout.plotY).toBeGreaterThan(layout.titleHeightPx + layout.tickHeightPx);
  });
  test("compacts dense rows and keeps dependency overlays inside the capped SVG", async () => {
    const denseInput: GanttChartInput = {
      type: "gantt",
      tasks: Array.from({ length: 32 }, (_, index) => ({
        id: `task-${index}`,
        label: `Task ${index}`,
        start: index,
        end: index + 2,
        group: index % 2 === 0 ? "build" : "test",
        progress: index % 3 === 0 ? 1 : 0.5,
        dependencies: index === 0 ? [] : [`task-${index - 1}`],
      })),
      milestones: [{ label: "Release", at: 34 }],
      maxHeightCells: 24,
    };
    const details = ganttChartRenderer.createDetails(
      ganttChartRenderer.parseParameters(denseInput),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const layout = ganttChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
    const svg = ganttChartRenderer.renderSvg(details, theme, layout);
    const textY = Array.from(svg.matchAll(/<text\b[^>]*\by="([0-9.e+-]+)"/g), (match) =>
      Number(match[1]),
    );
    expect(layout.heightCells).toBeLessThanOrEqual(24);
    expect(layout.rowHeightPx).toBeLessThan(26);
    expect(Math.max(...textY)).toBeLessThanOrEqual(layout.heightPx);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(await rasterizeSvg(svg)).toBeTruthy();
  }, 15_000);

  test("keeps output deterministic and round-trips replay details", () => {
    const details = ganttChartRenderer.createDetails(ganttChartRenderer.parseParameters(input), {
      imageWidthCells: 60,
      fontFamily: "sans-serif",
      fontSize: 16,
    });
    const layout = ganttChartRenderer.getLayout(details, undefined, details.imageWidthCells);
    expect(ganttChartRenderer.renderSvg(details, theme, layout)).toBe(
      ganttChartRenderer.renderSvg(details, theme, layout),
    );
    expect(ganttChartRenderer.deserializeDetails(details)).toEqual(details);
    expect(
      ganttChartRenderer.deserializeDetails({
        ...details,
        tasks: [{ ...details.tasks[0], dependencies: ["missing"] }],
      }),
    ).toBeUndefined();
  });

  test("executes in TUI and print modes", async () => {
    const { type: _type, ...parameters } = input;
    const tool = createGanttChartTool();
    const tuiResult = await tool.execute(
      "gantt-tui",
      parameters,
      undefined,
      undefined,
      context("tui"),
    );
    expect(tuiResult.content.map((part) => part.type)).toEqual(["text"]);
    expect(tuiResult.details).toMatchObject({ type: "gantt" });

    const printResult = await tool.execute(
      "gantt-print",
      parameters,
      undefined,
      undefined,
      context("print"),
    );
    expect(printResult.content.map((part) => part.type)).toEqual(["text", "image"]);
  });
});
