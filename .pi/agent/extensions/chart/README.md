# Chart extension

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
