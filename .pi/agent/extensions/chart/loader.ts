import { type ChartModules, type ChartTypeId, chartRegistry, chartTypeIds } from "./registry";

export type { ChartModules, ChartTypeId } from "./registry";

let sharedRuntimePromise: Promise<typeof import("./types")> | undefined;

/**
 * Dynamic imports are cached as promises, including rejected promises. A failed native/runtime
 * load stays visible as a stable chart error instead of retrying on every TUI render.
 */
export function loadChartType<K extends ChartTypeId>(type: K): Promise<ChartModules[K]> {
  return chartRegistry[type].load() as Promise<ChartModules[K]>;
}

export function loadChartRuntime(): Promise<typeof import("./types")> {
  sharedRuntimePromise ??= import("./types");
  return sharedRuntimePromise;
}

export async function shutdownChartRuntime(): Promise<void> {
  if (
    sharedRuntimePromise === undefined &&
    chartTypeIds.every((type) => chartRegistry[type].isLoaded() === false)
  )
    return;
  (await loadChartRuntime()).shutdownRasterizer();
}
