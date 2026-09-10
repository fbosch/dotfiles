# Chart extension

The enabled chart extension registers four focused tools:

- `chart_pie` renders labeled nonnegative values as a pie chart.
- `chart_bar` renders labeled signed values as a horizontal bar chart.
- `chart_line` renders numeric or temporal points as a single-series line chart. It accepts `null` y values as gaps and optional `markers`.
- `chart_scatter` renders one numeric x/y series as uniform, fixed-size dots. Points retain their input order; unordered and duplicate coordinates are valid. Optional point `label` values are shown beside their dots.

The extension registers tool metadata and public TypeBox schemas eagerly. Pi's existing prefix-based discovery still finds the four `chart_*` tools. The shared renderer (`types.ts`) and the requested chart adapter are loaded only when that chart is executed or replayed. Concurrent requests share the same cached import promise. A failed import is cached and reported as a stable chart-unavailable error rather than retried on every render.

Result rendering remains synchronous for Pi. The result slot starts loading on its first render, keeps the self-shell empty while the module loads, and invalidates the row when the chart component is ready. The wrapper keeps the latest width and theme, so a resize or theme change during loading does not render stale output. Replay selects the adapter from the tool name. Pie details saved before chart type metadata existed remain supported by `chart_pie`.

## Line charts

`chart_line` requires `xType`. `numeric` uses finite numeric `x` values; `temporal` uses UTC ISO dates (`YYYY-MM-DD`) or UTC datetimes ending in `Z`. Points must be strictly increasing. `y` values are finite numbers or `null`; a `null` creates a gap.

## Scatter charts

`chart_scatter` accepts between 2 and 200 rows of `{ x, y, label? }`. Both positions must be finite numbers. `title`, `xLabel`, and `yLabel` are optional. It has no series, grouping, color, or bubble-size channels.

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
