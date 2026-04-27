# Hyprland Lua Migration Plan

Hyprland is moving from hyprlang `.conf` files to Lua config. The migration goal is to keep the current setup stable while building a parallel Lua config that preserves behavior, especially generated window rules and window-state persistence.

## Current Decision

Use generated Lua data tables plus central loaders.

Generators should write data only. A hand-written loader should translate that data into `hl.window_rule(...)` calls.

Do not emit Hyprland named rules initially. Use internal `id` fields for dedupe instead, because named rules evaluate before anonymous rules and would change current rule precedence if only generated rules became named.

## Target Layout

```text
.config/hypr/
  hyprland.lua
  lua/
    rules.lua
    rules/
      workspace.lua
      window.lua
    rule-loader.lua
    generated-rules.lua
    window-state-rules.lua
```

`hyprland.lua` should require stable hand-written modules. Generated files should be loaded with `dofile`, not `require`, so reloads do not reuse stale cached modules. Generated writers should explicitly reload Hyprland once Lua config is live, because `dofile` paths are not source-backed as watched config paths.

## Generated Rule Schema

Use one shared schema for quickrule-generated rules and window-state rules.

```lua
return {
  {
    id = "window-state:match:class:Bitwarden",
    match = { class = "^Bitwarden$" },
    effects = {
      monitor = "DP-2",
      size = { 999, 1113 },
      move = { 1998, 99 },
    },
  },
}
```

### Fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | yes | Stable generator identity for overwrite/dedupe. Not passed to Hyprland initially. |
| `match` | yes | Window match table, e.g. `{ class = "^Bitwarden$" }`. |
| `effects` | yes | Normalized rule effects. Loader converts these to Hyprland Lua API shape. |
| `source` | no | Debug/source marker, e.g. `quickrule` or `window-state`. |
| `comment` | no | Human-readable context. Not identity. |

## Stable Overwrite Policy

Use stable overwrite for generated entries.

- Same `id`: replace the existing entry.
- New `id`: append a new entry.
- Never append duplicate entries for the same logical rule.
- Comments may change without affecting identity.

### ID Policy

| Producer | ID format |
| --- | --- |
| `hypr-quickrule` | `quickrule:<selector>:<escaped-match>:<profile-id>` |
| `window-state.sh` | `window-state:<matcher>:<pattern>` |

Keep IDs as plain strings. Slugging is only needed later if IDs become Hyprland rule names.

## Loader Responsibilities

`lua/rule-loader.lua` should own all Hyprland API mapping.

Responsibilities:

- Safely load optional generated files.
- Validate each entry has `id`, `match`, and `effects`.
- Convert normalized effects to `hl.window_rule(...)` fields.
- Emit anonymous window rules initially to preserve current precedence.
- Log or skip invalid generated entries without breaking the whole config, if the Lua API allows safe error handling.

Example conversion target:

```lua
hl.window_rule({
  match = { class = "^Bitwarden$" },
  monitor = "DP-2",
  size = "999 1113",
  move = "1998 99",
})
```

Upstream source currently exposes `size` and `move` as Lua config strings. The normalized generated schema may keep dimensions as numeric arrays, but `lua/rule-loader.lua` must convert them to strings before calling `hl.window_rule(...)`.

## Effect Mapping

| Current hyprlang rule | Data effect | Loader output |
| --- | --- | --- |
| `float on` | `float = true` | `float = true` |
| `pin on` | `pin = true` | `pin = true` |
| `no_anim on` | `no_anim = true` | `no_anim = true` |
| `fullscreen on` | `fullscreen = true` | `fullscreen = true` |
| `center on` | `center = true` | `center = true` |
| `monitor DP-2` | `monitor = "DP-2"` | `monitor = "DP-2"` |
| `size 750 900` | `size = { 750, 900 }` | `size = "750 900"` |
| `move 1998 99` | `move = { 1998, 99 }` | `move = "1998 99"` |
| `opacity 1.0 override 1.0 override` | `opacity = "1.0 override 1.0 override"` | string passthrough |
| `hyprbars:no_bar 1` | `hyprbars = { no_bar = 1 }` or passthrough | confirm plugin option mapping |

## Migration Phases

### 1. Freeze Current Config

Keep `.config/hypr/hyprland.conf` as the live config until Lua parity is ready.

Do not create a live `.config/hypr/hyprland.lua` until testing, because Hyprland selects Lua over `.conf` at startup when present.

### 2. Add Lua Skeleton

Create Lua modules in a non-live path or use a clearly staged filename until ready to restart into Lua.

Initial modules:

- `lua/rule-loader.lua`
- `lua/rules.lua`
- `lua/rules/workspace.lua`
- `lua/rules/window.lua`
- `lua/generated-rules.lua`
- `lua/window-state-rules.lua`

### 3. Convert Static Rules

Convert static `rules.conf` rules into `lua/rules.lua` first. Preserve current evaluation order.

Current order to preserve:

1. Quickrule generated rules from `generated-rules.conf`.
2. Static rules from `rules.conf`.
3. Window-state rules from `window-state-rules.conf`.

### 4. Convert `hypr-quickrule`

Update `.config/vicinae/extensions/hypr-quickrule/src/hypr-quickrule.tsx` to write `~/.config/hypr/lua/generated-rules.lua`.

Requirements:

- Write Lua data, not `hl.window_rule(...)` calls.
- Replace existing entry with same `id`.
- Keep profile effects normalized.
- Keep `Save Window State` behavior appending matchers to `window-state.conf` for now.
- Continue reloading Hyprland after writes once Lua config is live.

### 5. Convert `window-state.sh`

Keep the daemon architecture unchanged initially:

- socket2 events
- adaptive polling while tracked floating windows exist
- monitor-relative coordinates
- debounced writes
- immediate save on close

Only change the output format from `window-state-rules.conf` to `lua/window-state-rules.lua`.

Keep a temporary compatibility mode or backup writer for the old `.conf` format until the Lua config has proven stable.

### 6. Validate Reload Behavior

Test generated file updates with:

- restart into Lua config
- update a quickrule
- update a tracked window state
- `hyprctl reload config-only`
- `hyprctl configerrors`
- verify generated files are re-read

If `dofile` reload behavior is still stale, inspect whether Hyprland's Lua config manager caches chunks. Avoid `require` for generated files unless cache invalidation is explicit.

### 7. Consider Named Rules Later

After all window rules are Lua-managed, consider converting internal `id` to Hyprland `name`.

Benefits later:

- Dynamic enable/disable with rule handles.
- IPC mutation with `hyprctl keyword 'windowrule[name]:enable false'`.
- Potentially fewer full config reloads.

Do not do this in the first migration because named rules have different precedence.

## Generated Rules Options Rejected For Now

### Direct Generated `hl.window_rule(...)`

Rejected for initial migration because generated executable Lua increases escaping risk and spreads Hyprland API details across generators.

### Runtime-Only IPC Rules

Rejected as the primary path because persistence across restart still needs generated config/data.

### Lua-Native Window-State Daemon

Deferred. Lua exposes events and `hl.get_windows()`, but move/resize event coverage and file persistence behavior need proof. The current Bash daemon already solves this with socket2 plus adaptive polling.

## Risks

- Lua API is new and may change before or during Hyprland 0.55.
- `size`, `move`, plugin effects, and dynamic mutation formats must be confirmed against current docs/source.
- Regex and string escaping are the biggest generator hazards.
- Named rules change precedence; avoid until all relevant rules can be migrated together.
- Reload behavior for generated Lua files must be tested, not assumed.
- `window-state.sh` currently reloads on saves and handles `configreloaded`; avoid reload loops when changing output format.

## Rollback

Rollback must stay simple:

1. Remove or rename `.config/hypr/hyprland.lua`.
2. Restart Hyprland.
3. Hyprland loads `.config/hypr/hyprland.conf` again.
4. Keep old generated `.conf` outputs until Lua parity is proven.
