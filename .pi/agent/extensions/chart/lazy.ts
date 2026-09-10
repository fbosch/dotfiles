import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { CHART_COMPONENT_MARKER } from "./component-marker";
import { type ChartTypeId, loadChartRuntime, loadChartType } from "./loader";

type LoadedChartComponent = Component & { update(theme: Theme): void };

type LazyChartComponentOptions = {
  type: ChartTypeId;
  details: unknown;
  theme: Theme;
  requestRender: () => void;
  fallbackText?: string;
};

/**
 * The result slot stays synchronous for Pi's renderer. Loading starts only on the first actual
 * render, while the shared loader owns promise coalescing and sticky failures.
 */
export class LazyChartComponent implements Component {
  private readonly chartType: ChartTypeId;
  private details: unknown;
  private theme: Theme;
  private readonly requestRender: () => void;
  private readonly fallbackText: string | undefined;
  private delegate: LoadedChartComponent | undefined;
  private loadPromise: Promise<void> | undefined;
  private error: string | undefined;
  private fallback: string | undefined;

  constructor(options: LazyChartComponentOptions) {
    this.chartType = options.type;
    this.details = options.details;
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.fallbackText = options.fallbackText;
    Object.defineProperty(this, CHART_COMPONENT_MARKER, { value: true });
  }

  matches(type: ChartTypeId, details: unknown): boolean {
    return this.chartType === type && this.details === details;
  }

  update(details: unknown, theme: Theme): void {
    this.details = details;
    this.theme = theme;
    this.delegate?.update(theme);
  }

  invalidate(): void {
    this.delegate?.invalidate();
  }

  render(width: number): string[] {
    if (this.delegate !== undefined) return this.delegate.render(width);
    if (this.error !== undefined) {
      return [truncateToWidth(this.theme.fg("error", this.error), width)];
    }
    if (this.fallback !== undefined) return [truncateToWidth(this.fallback, width)];

    if (this.loadPromise === undefined) this.loadPromise = this.loadDelegate();
    return [];
  }

  private async loadDelegate(): Promise<void> {
    try {
      switch (this.chartType) {
        case "pie": {
          const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("pie")]);
          const details = module.pieChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? "Pie chart unavailable";
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.pieChartRenderer,
          );
          break;
        }
        case "bar": {
          const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("bar")]);
          const details = module.barChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? "Bar chart unavailable";
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.barChartRenderer,
          );
          break;
        }
        case "histogram": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("histogram"),
          ]);
          const details = module.histogramChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.histogramChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.histogramChartRenderer,
          );
          break;
        }
        case "bezier": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("bezier"),
          ]);
          const details = module.bezierChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.bezierChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.bezierChartRenderer,
          );
          break;
        }
        case "heatmap": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("heatmap"),
          ]);
          const details = module.heatmapChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.heatmapChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.heatmapChartRenderer,
          );
          break;
        }
        case "boxplot": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("boxplot"),
          ]);
          const details = module.boxplotChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.boxplotChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.boxplotChartRenderer,
          );
          break;
        }
        case "waterfall": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("waterfall"),
          ]);
          const details = module.waterfallChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.waterfallChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.waterfallChartRenderer,
          );
          break;
        }
        case "dumbbell": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("dumbbell"),
          ]);
          const details = module.dumbbellChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.dumbbellChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.dumbbellChartRenderer,
          );
          break;
        }
        case "stacked_bar": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("stacked_bar"),
          ]);
          const details = module.stackedBarChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? module.stackedBarChartRenderer.unavailableText;
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.stackedBarChartRenderer,
          );
          break;
        }
        case "line": {
          const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("line")]);
          const details = module.lineChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? "Line chart unavailable";
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.lineChartRenderer,
          );
          break;
        }
        case "scatter": {
          const [runtime, module] = await Promise.all([
            loadChartRuntime(),
            loadChartType("scatter"),
          ]);
          const details = module.scatterChartRenderer.deserializeDetails(this.details);
          if (details === undefined) {
            this.fallback = this.fallbackText ?? "Scatter chart unavailable";
            break;
          }
          this.delegate = new runtime.ChartComponent(
            details,
            this.theme,
            this.requestRender,
            module.scatterChartRenderer,
          );
          break;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.error = `${this.chartType} chart unavailable${message ? `: ${message}` : ""}`;
    } finally {
      // Keep a host invalidation failure from turning a handled import error into an unhandled rejection.
      try {
        this.requestRender();
      } catch (error: unknown) {
        if (this.error === undefined) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }
}
