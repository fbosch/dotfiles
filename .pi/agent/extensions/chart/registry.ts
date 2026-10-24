import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ChartDetails, ChartLayout, ChartSettings, ChartTheme, ChartType } from "./types";

type ChartRuntime = typeof import("./types");

export type LoadedChartComponent = Component & { update(theme: Theme): void };

type ChartDefinition<
  TModule,
  TParameters extends TSchema,
  TData,
  TDetails extends ChartDetails,
  TLayout extends ChartLayout,
> = {
  load: () => Promise<TModule>;
  renderer: (module: TModule) => ChartType<TParameters, TData, TDetails, TLayout>;
  fallbackText: string;
};

export type PreparedChart<TDetails extends ChartDetails> = {
  readonly details: TDetails;
  readonly settings: ChartSettings;
  readonly summary: string;
  renderSvg(runtime: ChartRuntime, theme: ChartTheme): string;
};

export type ChartDescriptor<TDetails extends ChartDetails = ChartDetails> = {
  readonly load: () => Promise<unknown>;
  readonly isLoaded: () => boolean;
  /** Resolves undefined when the input fails the chart's variant schema; settings are only created for valid input. */
  readonly prepare: (
    input: unknown,
    createSettings: () => ChartSettings,
  ) => Promise<PreparedChart<TDetails> | undefined>;
  readonly createComponent: (
    runtime: Promise<ChartRuntime>,
    details: unknown,
    theme: Theme,
    requestRender: () => void,
    fallbackText?: string,
  ) => Promise<LoadedChartComponent | string>;
};

function defineChart<
  TModule,
  TParameters extends TSchema,
  TData,
  TDetails extends ChartDetails,
  TLayout extends ChartLayout,
>(
  definition: ChartDefinition<TModule, TParameters, TData, TDetails, TLayout>,
): ChartDescriptor<TDetails> & { readonly load: () => Promise<TModule> } {
  let cachedModule: Promise<TModule> | undefined;

  const load = (): Promise<TModule> => {
    cachedModule ??= definition.load();
    return cachedModule;
  };

  return {
    load,
    isLoaded: () => cachedModule !== undefined,
    prepare: async (input, createSettings) => {
      const renderer = definition.renderer(await load());
      if (!Value.Check(renderer.parameters, input)) return undefined;
      const settings = createSettings();
      const details = renderer.createDetails(renderer.parseParameters(input), settings);
      return {
        details,
        settings,
        summary: renderer.getSummary(details),
        renderSvg: (runtime, theme) => runtime.renderChartSvg(renderer, details, theme),
      };
    },
    createComponent: async (runtimePromise, details, theme, requestRender, fallbackText) => {
      const [runtime, module] = await Promise.all([runtimePromise, load()]);
      const renderer = definition.renderer(module);
      const parsedDetails = renderer.deserializeDetails(details);
      if (parsedDetails === undefined) {
        return fallbackText ?? definition.fallbackText;
      }
      return new runtime.ChartComponent(parsedDetails, theme, requestRender, renderer);
    },
  };
}

export const chartRegistry = {
  pie: defineChart({
    load: () => import("./types/pie"),
    renderer: (module) => module.pieChartRenderer,
    fallbackText: "Pie chart unavailable",
  }),
  donut: defineChart({
    load: () => import("./types/donut"),
    renderer: (module) => module.donutChartRenderer,
    fallbackText: "Donut chart unavailable",
  }),
  bar: defineChart({
    load: () => import("./types/bar"),
    renderer: (module) => module.barChartRenderer,
    fallbackText: "Bar chart unavailable",
  }),
  scatter: defineChart({
    load: () => import("./types/scatter"),
    renderer: (module) => module.scatterChartRenderer,
    fallbackText: "Scatter chart unavailable",
  }),
  line: defineChart({
    load: () => import("./types/line"),
    renderer: (module) => module.lineChartRenderer,
    fallbackText: "Line chart unavailable",
  }),
  histogram: defineChart({
    load: () => import("./types/histogram"),
    renderer: (module) => module.histogramChartRenderer,
    fallbackText: "Histogram chart unavailable",
  }),
  bezier: defineChart({
    load: () => import("./types/bezier"),
    renderer: (module) => module.bezierChartRenderer,
    fallbackText: "Bezier chart unavailable",
  }),
  heatmap: defineChart({
    load: () => import("./types/heatmap"),
    renderer: (module) => module.heatmapChartRenderer,
    fallbackText: "Heatmap unavailable",
  }),
  boxplot: defineChart({
    load: () => import("./types/boxplot"),
    renderer: (module) => module.boxplotChartRenderer,
    fallbackText: "Box plot unavailable",
  }),
  waterfall: defineChart({
    load: () => import("./types/waterfall"),
    renderer: (module) => module.waterfallChartRenderer,
    fallbackText: "Waterfall unavailable",
  }),
  dumbbell: defineChart({
    load: () => import("./types/dumbbell"),
    renderer: (module) => module.dumbbellChartRenderer,
    fallbackText: "Dumbbell chart unavailable",
  }),
  stacked_bar: defineChart({
    load: () => import("./types/stacked-bar"),
    renderer: (module) => module.stackedBarChartRenderer,
    fallbackText: "Stacked bar chart unavailable",
  }),
  gantt: defineChart({
    load: () => import("./types/gantt"),
    renderer: (module) => module.ganttChartRenderer,
    fallbackText: "Gantt chart unavailable",
  }),
  network: defineChart({
    load: () => import("./types/network"),
    renderer: (module) => module.networkChartRenderer,
    fallbackText: "Network chart unavailable",
  }),
  tree: defineChart({
    load: () => import("./types/tree"),
    renderer: (module) => module.treeChartRenderer,
    fallbackText: "Tree chart unavailable",
  }),
  treemap: defineChart({
    load: () => import("./types/treemap"),
    renderer: (module) => module.treemapChartRenderer,
    fallbackText: "Treemap unavailable",
  }),
} as const;

export type ChartTypeId = keyof typeof chartRegistry;
export type ChartModules = {
  [K in ChartTypeId]: Awaited<ReturnType<(typeof chartRegistry)[K]["load"]>>;
};

export type ChartDetailsOf<K extends ChartTypeId> =
  (typeof chartRegistry)[K] extends ChartDescriptor<infer TDetails> ? TDetails : never;

export const chartTypeIds = Object.keys(chartRegistry) as ChartTypeId[];

export function isChartTypeId(value: unknown): value is ChartTypeId {
  return typeof value === "string" && Object.hasOwn(chartRegistry, value);
}
