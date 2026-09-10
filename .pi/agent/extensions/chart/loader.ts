export type ChartTypeId = "pie" | "bar" | "line" | "scatter";

export type ChartModules = {
  pie: typeof import("./types/pie");
  bar: typeof import("./types/bar");
  line: typeof import("./types/line");
  scatter: typeof import("./types/scatter");
};

let cachedPieModule: Promise<ChartModules["pie"]> | undefined;
let cachedBarModule: Promise<ChartModules["bar"]> | undefined;
let cachedLineModule: Promise<ChartModules["line"]> | undefined;
let cachedScatterModule: Promise<ChartModules["scatter"]> | undefined;
let sharedRuntimePromise: Promise<typeof import("./types")> | undefined;

/**
 * Dynamic imports are cached as promises, including rejected promises. A failed native/runtime
 * load stays visible as a stable chart error instead of retrying on every TUI render.
 */
export function loadChartType(type: "pie"): Promise<ChartModules["pie"]>;
export function loadChartType(type: "bar"): Promise<ChartModules["bar"]>;
export function loadChartType(type: "line"): Promise<ChartModules["line"]>;
export function loadChartType(type: "scatter"): Promise<ChartModules["scatter"]>;
export function loadChartType(type: ChartTypeId): Promise<ChartModules[ChartTypeId]> {
  switch (type) {
    case "pie":
      cachedPieModule ??= import("./types/pie");
      return cachedPieModule;
    case "bar":
      cachedBarModule ??= import("./types/bar");
      return cachedBarModule;
    case "line":
      cachedLineModule ??= import("./types/line");
      return cachedLineModule;
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
    cachedScatterModule === undefined
  )
    return;
  (await loadChartRuntime()).shutdownRasterizer();
}
