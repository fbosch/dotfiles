# Chart extension

## Line charts

The `chart` tool renders one line series. Use an explicit x-axis mode:

```json
{
  "type": "line",
  "xType": "numeric",
  "title": "Build time",
  "xLabel": "Commit",
  "yLabel": "Seconds",
  "data": [
    { "x": 0, "y": 42 },
    { "x": 1, "y": null },
    { "x": 2, "y": 37 }
  ]
}
```

`xType: "numeric"` requires finite numeric `x` values. `xType: "temporal"` requires UTC ISO dates (`YYYY-MM-DD`) or UTC datetimes ending in `Z`. Values must be strictly increasing. The tool rejects duplicate or out-of-order values rather than sorting them.

Each `y` is a finite number or `null`. A `null` creates a gap in the line. Charts need 2 to 200 rows and at least one numeric y value. `markers` is optional and defaults to `false`; set it to `true` to draw a marker for every numeric y value. `title`, `xLabel`, and `yLabel` are optional.

The y domain follows the observed values with modest padding. It does not force zero into the range. Numeric and temporal x positions use a linear scale, so elapsed time and numeric distance are preserved.

## Font configuration

Configure the chart font in Pi’s global `~/.pi/agent/settings.json`, or in a trusted project’s `.pi/settings.json`:

```json
{
  "charts": {
    "fontFamily": "Your font family"
  }
}
```

Project configuration overrides global configuration only when the project is trusted. Without `charts.fontFamily`, charts use `sans-serif`. The value is trimmed and must be a non-empty string of at most 200 characters; invalid `charts` configuration fails the chart tool call with a setting-specific error.

## Rendering

Charts rasterize with the bundled `@resvg/resvg-js` native renderer; `rsvg-convert` is not required. The renderer resolves the configured family and generic sans/monospace fallbacks through `fc-match` when available, caching the result per configured family. If fontconfig is unavailable, resvg uses the platform font registry.

Rasterization runs through resvg’s async native API. Cancellation and the 10-second timeout reject the chart request promptly and discard late output. resvg 2.6.2 does not reliably interrupt native work already in flight, so cancellation is logical rather than a hard native stop. Resizing aborts obsolete requests; the component keeps only one active request and ignores obsolete completions.
