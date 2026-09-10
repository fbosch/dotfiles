# Chart extension

The enabled chart extension registers six focused tools:

- `chart_pie` renders labeled nonnegative values as a pie chart.
- `chart_bar` renders labeled signed values as a horizontal bar chart.
- `chart_line` renders numeric or temporal points as a single-series line chart. It accepts `null` y values as gaps and optional `markers`.
- `chart_scatter` renders one numeric x/y series as uniform, fixed-size dots. Points retain their input order; unordered and duplicate coordinates are valid. Optional point `label` values are shown beside their dots.
- `chart_histogram` bins raw numeric samples into a count histogram.
- `chart_bezier` renders one exact cubic Bézier segment from four x/y points.

The extension registers tool metadata and public TypeBox schemas eagerly. All six `chart_*` tools remain active through Pi's tool discovery. The shared renderer (`types.ts`) and the requested chart adapter are loaded only when that chart is executed or replayed. Concurrent requests share the same cached import promise. A failed import is cached and reported as a stable chart-unavailable error rather than retried on every render.

Result rendering remains synchronous for Pi. The result slot starts loading on its first render, keeps the self-shell empty while the module loads, and invalidates the row when the chart component is ready. The wrapper keeps the latest width and theme, so a resize or theme change during loading does not render stale output. Replay selects the adapter from saved details, falling back to the tool name. Pie details saved before chart type metadata existed remain supported by `chart_pie`.

## Line charts

`chart_line` requires `xType`. `numeric` uses finite numeric `x` values; `temporal` uses UTC ISO dates (`YYYY-MM-DD`) or UTC datetimes ending in `Z`. Points must be strictly increasing. `y` values are finite numbers or `null`; a `null` creates a gap.

## Scatter charts

`chart_scatter` accepts between 2 and 200 rows of `{ x, y, label? }`. Both positions must be finite numbers. `title`, `xLabel`, and `yLabel` are optional. It has no series, grouping, color, or bubble-size channels.

## Histograms

`chart_histogram` accepts `data` as 1–200 finite numeric samples. Optional `bins` is an integer from 1 through 50. The default is `ceil(sqrt(sample count))`, capped at 50. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Labels are trimmed and cannot be blank. The Y axis always shows integer counts and defaults to the label `Count`.

Bins divide the observed minimum-to-maximum range equally. Each interval includes its lower boundary and excludes its upper boundary, except the last bin, which includes the maximum. Exact internal boundaries go to the bin on their right. Negative samples and duplicates are retained; input order does not affect counts. Empty bins are retained.

Constant samples use one centered bin, even when `bins` is supplied, with padding `max(0.5, abs(value) * 0.01)` on each side. Ranges that overflow, or bin boundaries that collapse at floating-point precision, fail explicitly. Rescale the samples or request fewer bins. Text summaries and saved details retain exact computed boundaries and counts; axis ticks are abbreviated for display.

```json
{ "data": [-2, -1, 0, 0, 2], "bins": 4, "title": "Samples", "xLabel": "Value" }
```

This produces counts `1, 1, 2, 1` for `[-2, -1)`, `[-1, 0)`, `[0, 1)`, and `[1, 2]`.

## Bézier charts

`chart_bezier` requires `start`, `control1`, `control2`, and `end`, each an object with finite numeric `x` and `y` coordinates from −1,000,000,000 through 1,000,000,000. These define one cubic segment, not samples to interpolate. The SVG contains one `M … C …` path using the supplied controls.

`showControls` defaults to `false`. Set it to `true` to show two subtle endpoint-to-control guides and control-point markers. Endpoint markers remain visible, including when all four points coincide. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Labels are trimmed and cannot be blank.

```json
{
  "start": { "x": 0, "y": 0 },
  "control1": { "x": 4, "y": 8 },
  "control2": { "x": -4, "y": 8 },
  "end": { "x": 2, "y": 0 },
  "showControls": true
}
```

Both axes use the same pixels per unit, preserving angles and proportions at different terminal sizes. The viewport includes all four points even when controls are hidden, so toggling guides does not change the curve. Straight, horizontal, vertical, closed, and coincident segments are valid. Near-coincident and subnormal ranges receive minimum viewport padding to avoid floating-point collapse; the stored coordinates are unchanged.

The default presentation is a compact square with minimal padding and no axes, ticks, or visible title. Explicit titles and axis labels reserve their own space outside the square plot. The plot is capped at ten terminal rows in physical pixels and shrinks to fit the available width.

Bézier rendering uses the installed `@tanstack/charts` scene and SVG renderer: a scene path carries the exact cubic, `dot` marks render endpoints, and scene rules and dots render optional controls. The shared worker rasterizer, full-resolution output, cached image identities, and resume queue timeout handling are unchanged.

## Font configuration

Configure `charts.fontFamily` and the optional `charts.fontSize` in global `~/.pi/agent/settings.json`, or in a trusted project's `.pi/settings.json`. Project values override global values. `fontSize` is a logical-pixel number from `8` through `32`; when omitted, every chart keeps its existing built-in text sizes.

```json
{
  "charts": {
    "fontFamily": "Zenbones Brainy",
    "fontSize": 14
  }
}
```

Invalid chart settings fail the tool call.

## Rendering

Charts use bundled async `@resvg/resvg-js`. Font resolution, raster cache behavior, theme rendering, cancellation, and the ten-second timeout are shared across all chart tools.

## Startup measurement

The following cold-process measurement used five fresh Bun subprocesses per case. Each subprocess preloaded `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`, and `typebox/value`, then loaded the chart extension through Pi's extension loader. The extension interval is the time from host preload to extension registration completion. RSS is a rough process-memory delta, not an allocation profile. The before values are the baseline captured before this refactor; the after values were rerun with the same harness.

| Metric                    | Before lazy loading | After lazy loading |
| ------------------------- | ------------------: | -----------------: |
| Extension interval median |             35.9 ms |             5.0 ms |
| RSS delta median          |          10,012 KiB |          1,140 KiB |

The measurement covers extension import and registration, not full interactive Pi startup or first-chart latency. The first chart still pays for the shared renderer and the selected adapter when it is actually needed.
