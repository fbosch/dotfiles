export type ChartTypeId =
  | "pie"
  | "bar"
  | "line"
  | "scatter"
  | "histogram"
  | "bezier"
  | "heatmap"
  | "boxplot"
  | "waterfall"
  | "dumbbell"
  | "stacked_bar"
  | "treemap"
  | "tree";

export type ChartModules = {
  treemap: typeof import("./types/treemap");
  tree: typeof import("./types/tree");
  stacked_bar: typeof import("./types/stacked-bar");
  dumbbell: typeof import("./types/dumbbell");
  waterfall: typeof import("./types/waterfall");
  boxplot: typeof import("./types/boxplot");
  heatmap: typeof import("./types/heatmap");
  bezier: typeof import("./types/bezier");
  pie: typeof import("./types/pie");
  bar: typeof import("./types/bar");
  line: typeof import("./types/line");
  histogram: typeof import("./types/histogram");
  scatter: typeof import("./types/scatter");
};

let cachedTreeModule: Promise<ChartModules["tree"]> | undefined;
let cachedTreemapModule: Promise<ChartModules["treemap"]> | undefined;
let cachedStackedBarModule: Promise<ChartModules["stacked_bar"]> | undefined;
let cachedDumbbellModule: Promise<ChartModules["dumbbell"]> | undefined;
let cachedWaterfallModule: Promise<ChartModules["waterfall"]> | undefined;
let cachedBoxplotModule: Promise<ChartModules["boxplot"]> | undefined;
let cachedHeatmapModule: Promise<ChartModules["heatmap"]> | undefined;
let cachedBezierModule: Promise<ChartModules["bezier"]> | undefined;
let cachedPieModule: Promise<ChartModules["pie"]> | undefined;
let cachedBarModule: Promise<ChartModules["bar"]> | undefined;
let cachedLineModule: Promise<ChartModules["line"]> | undefined;
let cachedHistogramModule: Promise<ChartModules["histogram"]> | undefined;
let cachedScatterModule: Promise<ChartModules["scatter"]> | undefined;
let sharedRuntimePromise: Promise<typeof import("./types")> | undefined;

/**
 * Dynamic imports are cached as promises, including rejected promises. A failed native/runtime
 * load stays visible as a stable chart error instead of retrying on every TUI render.
 */
export function loadChartType(type: "tree"): Promise<ChartModules["tree"]>;
export function loadChartType(type: "treemap"): Promise<ChartModules["treemap"]>;
export function loadChartType(type: "stacked_bar"): Promise<ChartModules["stacked_bar"]>;
export function loadChartType(type: "dumbbell"): Promise<ChartModules["dumbbell"]>;
export function loadChartType(type: "waterfall"): Promise<ChartModules["waterfall"]>;
export function loadChartType(type: "boxplot"): Promise<ChartModules["boxplot"]>;
export function loadChartType(type: "heatmap"): Promise<ChartModules["heatmap"]>;
export function loadChartType(type: "bezier"): Promise<ChartModules["bezier"]>;
export function loadChartType(type: "pie"): Promise<ChartModules["pie"]>;
export function loadChartType(type: "bar"): Promise<ChartModules["bar"]>;
export function loadChartType(type: "line"): Promise<ChartModules["line"]>;
export function loadChartType(type: "scatter"): Promise<ChartModules["scatter"]>;
export function loadChartType(type: "histogram"): Promise<ChartModules["histogram"]>;
export function loadChartType(type: ChartTypeId): Promise<ChartModules[ChartTypeId]> {
  switch (type) {
    case "tree":
      cachedTreeModule ??= import("./types/tree");
      return cachedTreeModule;
    case "treemap":
      cachedTreemapModule ??= import("./types/treemap");
      return cachedTreemapModule;
    case "stacked_bar":
      cachedStackedBarModule ??= import("./types/stacked-bar");
      return cachedStackedBarModule;
    case "dumbbell":
      cachedDumbbellModule ??= import("./types/dumbbell");
      return cachedDumbbellModule;
    case "waterfall":
      cachedWaterfallModule ??= import("./types/waterfall");
      return cachedWaterfallModule;
    case "boxplot":
      cachedBoxplotModule ??= import("./types/boxplot");
      return cachedBoxplotModule;
    case "heatmap":
      cachedHeatmapModule ??= import("./types/heatmap");
      return cachedHeatmapModule;
    case "bezier":
      cachedBezierModule ??= import("./types/bezier");
      return cachedBezierModule;
    case "pie":
      cachedPieModule ??= import("./types/pie");
      return cachedPieModule;
    case "bar":
      cachedBarModule ??= import("./types/bar");
      return cachedBarModule;
    case "line":
      cachedLineModule ??= import("./types/line");
      return cachedLineModule;
    case "histogram":
      cachedHistogramModule ??= import("./types/histogram");
      return cachedHistogramModule;
    case "scatter":
      cachedScatterModule ??= import("./types/scatter");
      return cachedScatterModule;
  }
}

export function loadChartRuntime(): Promise<typeof import("./types")> {
  sharedRuntimePromise ??= import("./types");
  return sharedRuntimePromise;
}

export async function shutdownChartRuntime(): Promise<void> {
  if (
    sharedRuntimePromise === undefined &&
    cachedPieModule === undefined &&
    cachedBarModule === undefined &&
    cachedLineModule === undefined &&
    cachedScatterModule === undefined &&
    cachedHistogramModule === undefined &&
    cachedHeatmapModule === undefined &&
    cachedBoxplotModule === undefined &&
    cachedWaterfallModule === undefined &&
    cachedDumbbellModule === undefined &&
    cachedStackedBarModule === undefined &&
    cachedTreeModule === undefined &&
    cachedTreemapModule === undefined &&
    cachedBezierModule === undefined
  )
    return;
  (await loadChartRuntime()).shutdownRasterizer();
}
