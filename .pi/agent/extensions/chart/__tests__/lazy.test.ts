import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { LazyChartComponent } from "../lazy";
import { loadChartRuntime, loadChartType } from "../loader";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;255;255;255m",
} as unknown as Theme;

describe("lazy chart architecture", () => {
  test("registers five tools in a fresh process without loading the native renderer", async () => {
    const probe = [
      "const extension = await import(process.argv[1]);",
      "const names = [];",
      "extension.default({ on() {}, registerTool(tool) { names.push(tool.name); } });",
      'console.log(JSON.stringify({ names, native: process.moduleLoadList.filter((name) => name.toLowerCase().includes("resvg")) }));',
    ].join("\n");
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-install",
        "-e",
        probe,
        new URL("../index.ts", import.meta.url).pathname,
      ],
      { stderr: "pipe", stdout: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      names: ["chart_pie", "chart_bar", "chart_scatter", "chart_line", "chart_histogram"],
      native: [],
    });
  });

  test("keeps rendering dependencies out of the entrypoint's static bundle graph", async () => {
    const outputDirectory = await mkdtemp("/tmp/pi-chart-lazy-test-");
    try {
      const build = await Bun.build({
        entrypoints: [new URL("../index.ts", import.meta.url).pathname],
        outdir: outputDirectory,
        splitting: true,
        target: "bun",
      });
      if (!build.success) throw new Error(build.logs.map((log) => log.message).join("\n"));

      const staticFiles = new Set(["index.js"]);
      const visited = new Set<string>();
      while (staticFiles.size > visited.size) {
        const fileName = [...staticFiles].find((candidate) => !visited.has(candidate));
        if (fileName === undefined) break;
        visited.add(fileName);
        const source = await Bun.file(join(outputDirectory, fileName)).text();
        for (const line of source.split("\n")) {
          const importStart = line.indexOf('import "');
          const fromStart = line.indexOf('from "');
          const quoteStart =
            importStart >= 0 ? importStart + 8 : fromStart >= 0 ? fromStart + 6 : -1;
          if (quoteStart < 0) continue;
          const quoteEnd = line.indexOf('"', quoteStart);
          if (quoteEnd < 0) continue;
          const specifier = line.slice(quoteStart, quoteEnd);
          if (specifier.startsWith("./")) staticFiles.add(specifier.slice(2));
        }
      }

      const staticGraph = await Promise.all(
        [...visited].map((fileName) => Bun.file(join(outputDirectory, fileName)).text()),
      );
      expect(staticGraph.join("\n")).not.toContain("@resvg/resvg-js");
      expect(staticGraph.join("\n")).not.toContain("@tanstack/charts");
      expect(staticGraph.join("\n")).not.toContain("// extensions/chart/types/histogram.ts");
      const outputFiles = (await readdir(outputDirectory)).filter((fileName) =>
        fileName.endsWith(".js"),
      );
      const outputSources = await Promise.all(
        outputFiles.map((fileName) => Bun.file(join(outputDirectory, fileName)).text()),
      );
      expect(outputSources.some((source) => source.includes("// extensions/chart/types.ts"))).toBe(
        true,
      );
      expect(
        outputSources.some((source) => source.includes("// extensions/chart/types/pie.ts")),
      ).toBe(true);
      expect(
        outputSources.some((source) => source.includes("// extensions/chart/types/bar.ts")),
      ).toBe(true);
      expect(
        outputSources.some((source) => source.includes("// extensions/chart/types/line.ts")),
      ).toBe(true);
      expect(
        outputSources.some((source) => source.includes("// extensions/chart/types/scatter.ts")),
      ).toBe(true);
      expect(
        outputSources.some((source) => source.includes("// extensions/chart/types/histogram.ts")),
      ).toBe(true);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  test("coalesces concurrent requests for one chart adapter and the shared runtime", async () => {
    const adapter = loadChartType("histogram");
    const runtime = loadChartRuntime();
    expect(loadChartType("histogram")).toBe(adapter);
    expect(loadChartRuntime()).toBe(runtime);
    expect(await loadChartType("histogram")).toBe(await adapter);
    expect(await loadChartRuntime()).toBe(await runtime);
  });

  test("starts replay loading on first render and keeps malformed details visible", async () => {
    let invalidations = 0;
    let resolveInvalidation: () => void = () => undefined;
    const invalidation = new Promise<void>((resolve) => {
      resolveInvalidation = resolve;
    });
    const component = new LazyChartComponent({
      type: "pie",
      details: { rows: "not chart rows", imageWidthCells: 60 },
      theme,
      requestRender: () => {
        invalidations += 1;
        resolveInvalidation();
      },
    });

    expect(component.render(64)).toEqual([]);
    await invalidation;
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(invalidations).toBeGreaterThan(0);
  });
});
