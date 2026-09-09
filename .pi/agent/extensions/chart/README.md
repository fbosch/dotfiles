# Chart extension

The enabled chart extension registers four focused tools:

- `chart_pie` renders labeled nonnegative values as a pie chart.
- `chart_bar` renders labeled signed values as a horizontal bar chart.
- `chart_line` renders numeric or temporal points as a single-series line chart. It accepts `null` y values as gaps and optional `markers`.
- `chart_scatter` renders one numeric x/y series as uniform, fixed-size dots. Points retain their input order; unordered and duplicate coordinates are valid. Optional point `label` values are shown beside their dots.

Chart tools are deferred at session startup. Pi loads the requested chart tool through its existing tool discovery when a chart capability is needed; there is no user slash command.

## Line charts

`chart_line` requires `xType`. `numeric` uses finite numeric `x` values; `temporal` uses UTC ISO dates (`YYYY-MM-DD`) or UTC datetimes ending in `Z`. Points must be strictly increasing. `y` values are finite numbers or `null`; a `null` creates a gap.

## Scatter charts

`chart_scatter` accepts between 2 and 200 rows of `{ x, y, label? }`. Both positions must be finite numbers. `title`, `xLabel`, and `yLabel` are optional. It has no series, grouping, color, or bubble-size channels.

## Font configuration

Configure `charts.fontFamily` and the optional `charts.fontSize` in global `~/.pi/agent/settings.json`, or in a trusted project’s `.pi/settings.json`. Project values override global values. `fontSize` is a logical-pixel number from `8` through `32`; when omitted, every chart keeps its existing built-in text sizes.

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
