# Controls Cache

`mode: "controls-cache"` stores and looks up app/window-specific controls for guarded keyboard use. This keeps discovered controls out of conversation-only memory and makes future target inspections show known bindings before sending keys.

## Storage

The cache is written to:

```text
${XDG_STATE_HOME:-~/.local/state}/hypr-computer-use/controls.json
```

Tests and local debugging can override this with `controlsCachePath`.

## Target Key

Profiles are keyed by normalized Hyprland `class` and `title`:

```text
class:<class>|title:<title>
```

The window address and stable ID are session-specific, so they are not used as persistent cache keys.

## Saving Controls

Use `mode: "controls-cache"` with a resolved target and a `controls` payload:

```json
{
  "mode": "controls-cache",
  "targetHint": "infinitefusion",
  "controls": {
    "source": "Essentials controls wiki and Infinite Fusion FAQ",
    "notes": "Summary pages use page-up/page-down style bindings.",
    "bindings": [
      { "action": "summary.previousPage", "keys": ["A"], "note": "Input::JUMPUP" },
      { "action": "summary.nextPage", "keys": ["S"], "note": "Input::JUMPDOWN" },
      { "action": "confirm/use", "keys": ["C", "Space", "Enter"] },
      { "action": "back/cancel", "keys": ["X", "Escape"] },
      { "action": "openControls", "keys": ["F1"] }
    ]
  }
}
```

## Lookup

Calling `mode: "controls-cache"` without `controls` returns the cached profile for the resolved target.

`mode: "app-approval"` also includes `controls` when a profile exists. Agents should check that field before trying navigation keys.

## Boundaries

- The cache stores controls metadata only, not screenshots or clipboard contents.
- Cache entries replace the previous profile for the same class/title pair.
- Invalid cache files fail loudly with `controls-cache-invalid` instead of silently dropping data.
