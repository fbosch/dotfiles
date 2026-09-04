# Pi Compaction Customization

A global Pi extension for fractional compaction controls.

## Settings

Configure these under the global `compaction` object in `.pi/agent/settings.json`:

```json
{
  "compaction": {
    "threshold": 0.25,
    "keepRecentPercent": 0.25
  }
}
```

- `threshold` is the fraction of the model context window reserved as headroom. `0.25` triggers threshold compaction at 75% context usage.
- `keepRecentPercent` is the fraction of the active context retained without summarizing. `0.25` retains the newest 25%.

Threshold checks run when the agent becomes settled, so the extension does not interrupt an active tool loop. Pi's native `reserveTokens` check remains available as a safety net during active runs.

Both settings are opt-in and accept finite numbers strictly between `0` and `1`. The extension reads global settings only; project-local settings are ignored.
