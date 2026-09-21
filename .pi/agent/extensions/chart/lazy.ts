import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { CHART_COMPONENT_MARKER } from "./component-marker";
import { type ChartTypeId, loadChartRuntime } from "./loader";
import { chartRegistry, type LoadedChartComponent } from "./registry";

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
      const delegate = await chartRegistry[this.chartType].createComponent(
        loadChartRuntime(),
        this.details,
        this.theme,
        this.requestRender,
        this.fallbackText,
      );
      if (typeof delegate === "string") this.fallback = delegate;
      else this.delegate = delegate;
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
