import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { Resvg } from "@resvg/resvg-js";
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
import { getChartSurfaceColor, getContrastingTextColor } from "../types/shared";
import manifest from "./fixtures/visual-validation/manifest.json";

const darkColors: Record<string, string> = {
  text: "187;187;187",
  accent: "102;165;173",
  success: "129;155;105",
  warning: "183;126;100",
  error: "222;110;124",
  thinkingLow: "96;153;192",
  thinkingMedium: "102;165;173",
  thinkingHigh: "178;121;167",
  thinkingXhigh: "183;126;100",
  thinkingMax: "222;110;124",
  bashMode: "129;155;105",
};
const theme = {
  getFgAnsi: (color: string) => `\u001b[38;2;${darkColors[color] ?? "167;139;250"}m`,
};

const lightTheme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;31;35;40m" : "\u001b[38;2;84;125;167m",
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

  test("chooses black or white in-cell labels for dark and light chart surfaces", () => {
    expect(getChartSurfaceColor("rgb(187, 187, 187)")).toBe("#181819");
    expect(getChartSurfaceColor("rgb(31, 35, 40)")).toBe("#f8f8f8");
    expect(getContrastingTextColor("#66a5ad", 0.2, "#181819")).toBe("#ffffff");
    expect(getContrastingTextColor("#66a5ad", 0.2, "#f8f8f8")).toBe("#000000");
    const contrastInput: GanttChartInput = {
      type: "gantt",
      tasks: [{ id: "zero", label: "Zero progress", start: 0, end: 4, group: "follow-up" }],
    };
    const details = ganttChartRenderer.createDetails(
      ganttChartRenderer.parseParameters(contrastInput),
      { imageWidthCells: 60, fontFamily: "sans-serif" },
    );
    const renderLabel = (chartTheme: { getFgAnsi: (color: string) => string }) => {
      const layout = ganttChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, 60);
      const svg = ganttChartRenderer.renderSvg(details, chartTheme, layout);
      return svg.match(/<text\b[^>]*>0%<\/text>/)?.[0];
    };
    expect(renderLabel(theme)).toContain('fill="#ffffff"');
    expect(renderLabel(lightTheme)).toContain('fill="#000000"');
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

function svgAttributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

const fontFile = execFileSync("fc-match", ["-f", "%{file}", "sans-serif"], { encoding: "utf8" });
const rasterOptions = {
  font: { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: "sans-serif" },
};

const manifestGantt = manifest.charts.find((chart) => chart.chart === "gantt");
if (!manifestGantt) throw new Error("missing frozen gantt fixtures");
for (const fixture of manifestGantt.cases) {
  const views = [
    ...fixture.profiles.map((profile) => ({ profile, maxHeightCells: undefined })),
    ...(fixture.heightCaps ?? []),
  ];
  for (const view of views) {
    test(`exact manifest ${fixture.id}/${view.profile}: distinct intervals and collision-free text`, async () => {
      const width = view.profile.startsWith("N") ? 28 : 60;
      const parameters = {
        type: "gantt",
        ...fixture.args,
        ...(view.maxHeightCells === undefined ? {} : { maxHeightCells: view.maxHeightCells }),
      };
      if (!Value.Check(ganttChartVariant, parameters)) throw new Error("invalid frozen fixture");
      const details = ganttChartRenderer.createDetails(
        ganttChartRenderer.parseParameters(parameters),
        { imageWidthCells: width, fontFamily: "sans-serif" },
      );
      const layout = ganttChartRenderer.getLayout(details, { widthPx: 9, heightPx: 18 }, width);
      const svg = ganttChartRenderer.renderSvg(details, theme, layout);
      expect(layout.widthPx).toBe(width * 9);
      if (view.maxHeightCells === undefined) expect(layout.rowHeightPx).toBeGreaterThanOrEqual(25);
      expect(layout.rowHeightPx).toBeGreaterThanOrEqual(5);
      expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({
        widthPx: width * 9,
        heightPx: layout.heightPx,
      });
      if (view.maxHeightCells !== undefined)
        expect(layout.heightPx).toBeLessThanOrEqual(view.maxHeightCells * 18);
      const bars = [...svg.matchAll(/<rect\b[^>]*\/>/g)]
        .map((m) => m[0])
        .filter((tag) => svgAttributes(tag)["data-ts-key"]?.includes(":background-"));
      expect(bars).toHaveLength(details.tasks.length);
      const sorted = bars.map(svgAttributes).sort((a, b) => Number(a.y) - Number(b.y));
      const domain = Math.max(
        ...details.tasks.map((task) => task.end),
        ...details.milestones.map((milestone) => milestone.at),
      );
      for (const [index, bar] of sorted.entries()) {
        const task = details.tasks[index];
        if (!task) throw new Error("missing task interval");
        expect(Number(bar.x)).toBeCloseTo((task.start / domain) * layout.plotWidthPx, 2);
        expect(Number(bar.width)).toBeCloseTo(
          ((task.end - task.start) / domain) * layout.plotWidthPx,
          2,
        );
        expect(Number(bar.height)).toBeGreaterThanOrEqual(2);
        if (index > 0)
          expect(
            Number(bar.y) - Number(sorted[index - 1]?.y) - Number(sorted[index - 1]?.height),
          ).toBeGreaterThanOrEqual(1.5);
      }
      const dependencies = [...svg.matchAll(/<path\b[^>]*class="pi-gantt-dependency"[^>]*\/>/g)];
      expect(dependencies).toHaveLength(
        details.tasks.reduce((count, task) => count + task.dependencies.length, 0),
      );
      let dependencyIndex = 0;
      for (const [targetIndex, task] of details.tasks.entries()) {
        for (const id of task.dependencies) {
          const sourceIndex = details.tasks.findIndex((source) => source.id === id);
          const source = details.tasks[sourceIndex];
          const path = svgAttributes(dependencies[dependencyIndex++]?.[0] ?? "").d;
          if (!source || !path) throw new Error("missing dependency geometry");
          const sourceX = layout.plotX + (source.end / domain) * layout.plotWidthPx;
          const sourceY = layout.plotY + (sourceIndex + 0.5) * layout.rowHeightPx;
          const targetX = layout.plotX + (task.start / domain) * layout.plotWidthPx;
          const targetY = layout.plotY + (targetIndex + 0.5) * layout.rowHeightPx;
          expect(path.startsWith(`M ${sourceX} ${sourceY} H `)).toBe(true);
          expect(path.endsWith(` V ${targetY} H ${targetX}`)).toBe(true);
          if (sourceX > targetX) {
            const approachX = Number(path.match(/H ([0-9.e+-]+) V [0-9.e+-]+ H [0-9.e+-]+$/)?.[1]);
            expect(approachX).toBeLessThan(targetX);
          }
        }
      }
      expect(svg.match(/class="pi-gantt-milestone-leader"/g)).toHaveLength(
        details.milestones.length,
      );
      const summary = ganttChartRenderer.getSummary(details);
      for (const milestone of details.milestones)
        expect(summary).toContain(`${milestone.label} @ ${milestone.at}`);
      for (const task of details.tasks)
        expect(summary).toContain(
          `${task.label} [${task.id}] ${task.start}-${task.end} progress=${task.progress}`,
        );

      const opening = svg.slice(0, svg.indexOf(">") + 1);
      const intervalRaster = new Resvg(
        `${opening}<g transform="translate(${layout.plotX} ${layout.plotY})">${bars.join("")}</g></svg>`,
        rasterOptions,
      ).render();
      const intervalPixels = intervalRaster.pixels;
      const rowInk = (y: number) => {
        let count = 0;
        for (let x = 0; x < intervalRaster.width; x++)
          if ((intervalPixels[(y * intervalRaster.width + x) * 4 + 3] ?? 0) > 32) count++;
        return count;
      };
      for (let index = 0; index < details.tasks.length; index++) {
        expect(
          rowInk(Math.floor(layout.plotY + (index + 0.5) * layout.rowHeightPx)),
        ).toBeGreaterThan(0);
        if (index > 0)
          expect(rowInk(Math.floor(layout.plotY + index * layout.rowHeightPx))).toBe(0);
      }
      // Independent alpha masks catch glyph collisions rather than trusting estimated text widths.
      const occupied = new Uint8Array(layout.widthPx * layout.heightPx);
      for (const match of svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)) {
        const tag = match[0];
        expect(Number(svgAttributes(tag)["font-size"])).toBeGreaterThanOrEqual(8);
        const positioned = tag.includes("progress-label-")
          ? `<g transform="translate(${layout.plotX} ${layout.plotY})">${tag}</g>`
          : tag;
        const rendered = new Resvg(`${opening}${positioned}</svg>`, rasterOptions);
        const bounds = rendered.getBBox();
        if (!bounds) throw new Error(`text did not render: ${tag}`);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.widthPx);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.heightPx);
        const image = rendered.render();
        const pixels = image.pixels;
        for (let pixel = 0; pixel < occupied.length; pixel++) {
          if ((pixels[pixel * 4 + 3] ?? 0) < 32) continue;
          expect(occupied[pixel]).toBe(0);
          occupied[pixel] = 1;
        }
      }
    }, 15_000);
  }
}
