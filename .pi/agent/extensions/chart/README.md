# Chart extension

Configure the pie-chart font in Pi’s global `~/.pi/agent/settings.json`, or in a trusted project’s `.pi/settings.json`:

```json
{
  "charts": {
    "fontFamily": "Your font family"
  }
}
```

Project configuration overrides global configuration only when the project is trusted. Without `charts.fontFamily`, charts use `sans-serif`. The value is trimmed and must be a non-empty string of at most 200 characters; invalid `charts` configuration fails the chart tool call with a setting-specific error.
