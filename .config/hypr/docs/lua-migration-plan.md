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
    base.lua
    programs.lua
    monitors.lua
    autostart.lua
    keybinds.lua
    animations.lua
    environment.lua
    appearance.lua
    input.lua
    actions/
      close-active.lua
      confirm-exit.lua
      confirm-hyprprop-kill.lua
      toggle-powersave-mode.lua
      window-switcher.lua
    lib/
      ags.lua
      command.lua
      fs.lua
      json.lua
      log.lua
      notify.lua
      paths.lua
      system.lua
      window.lua
    rules/
      init.lua
      generated.lua
      window-state.lua
      workspace-base.lua
      layer.lua
      workspace.lua
      window.lua
    runtime/
      gaming/
        daemons/
          gaming-session-watchdog/
            gaming-session-watchdog.sh
      session/
        exit-session.sh
      startup/
        startup-desktop-ready.sh
      windows/
        confirm-hyprprop-kill.sh
        toggle-show-desktop.sh
        toggle-minimized-window.sh
        toggle-minimized-workspace.sh
    rule-loader.lua
```

`hyprland.lua` requires stable hand-written modules with config-root module paths, for example `require("programs")` and `require("rules")`. The entrypoint sets `package.path` to `~/.config/hypr/?.lua;~/.config/hypr/?/init.lua` before requiring modules so plain `lua` validation matches Hyprland's module lookup. Generated data files are loaded by absolute path through `rule-loader.lua`, not `require`, so reloads do not reuse stale cached modules. Generated writers should explicitly reload Hyprland once Lua config is live, because generated data paths are not source-backed as watched config paths.

Legacy `.conf` migration helpers are retained under `legacy/`; stable hand-written modules and runtime helpers now live at config root.

## Generated Rule Schema

Use one shared schema for quickrule-generated rules and window-state rules.

```lua
return {
  {
    id = "window-state:match:class:Bitwarden",
    match = { class = "^Bitwarden$" },
    effects = {
      monitor = "DP-2",
      size = "999 1113",
      move = "1998 99",
    },
  },
}
```

### Fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | yes | Stable generator identity for overwrite/dedupe. Not passed to Hyprland initially. |
| `match` | yes | Window match table, e.g. `{ class = "^Bitwarden$" }`. |
| `effects` | yes | Hyprland Lua rule fields, excluding `match`. |
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

`rule-loader.lua` should own all Hyprland API mapping.

Responsibilities:

- Safely load optional generated files.
- Validate each entry has `id`, `match`, and `effects`.
- Copy `effects` onto anonymous `hl.window_rule(...)` tables without generator-specific normalization.
- Apply generated/window-state data with `hl.window_rule(...)` when running under Hyprland.
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

Upstream source currently exposes `size` and `move` as Lua config strings. Generated writers must emit those fields as strings before `rule-loader.lua` sees them.

## Effect Mapping

| Current hyprlang rule | Data effect | Loader output |
| --- | --- | --- |
| `float on` | `float = true` | `float = true` |
| `pin on` | `pin = true` | `pin = true` |
| `no_anim on` | `no_anim = true` | `no_anim = true` |
| `fullscreen on` | `fullscreen = true` | `fullscreen = true` |
| `center on` | `center = true` | `center = true` |
| `monitor DP-2` | `monitor = "DP-2"` | `monitor = "DP-2"` |
| `size 750 900` | `size = "750 900"` | `size = "750 900"` |
| `move 1998 99` | `move = "1998 99"` | `move = "1998 99"` |
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
- `rules/init.lua`
- `rules/generated.lua`
- `rules/window-state.lua`
- `rules/layer.lua`
- `rules/workspace.lua`
- `rules/window.lua`

### 3. Convert Static Rules

Convert static `rules.conf` rules into `rules/init.lua`, `rules/workspace.lua`, and `rules/window.lua` first. Preserve current evaluation order.

Current order to preserve:

1. Quickrule generated rules from `generated-rules.conf`.
2. Static rules from `rules.conf`.
3. Window-state rules from `window-state-rules.conf`.

Static layer rules from `appearance.conf` live in `rules/layer.lua`, but should be loaded in the appearance phase rather than from `rules/init.lua` so their relative order stays close to the live config.

### 3.5. Convert Low-Risk Base Modules

Current staged modules:

- `lua/base.lua`
- `lua/programs.lua`
- `lua/monitors.lua`
- `lua/autostart.lua`
- `lua/keybinds.lua`
- `rules/workspace-base.lua`
- `lua/animations.lua`
- `lua/environment.lua`
- `lua/appearance.lua`
- `rules/layer.lua`
- `lua/input.lua`
- `lua/lib/system.lua`

Known staged gap: namespace-specific layer animations from `animations.conf` are documented in `lua/animations.lua` until the exact Hyprland Lua API shape is confirmed.

Known staged keybind gaps: mouse binds are represented in `lua/keybinds.lua`, but upstream Lua currently does not appear to wire `opts.mouse` into keybind objects, and `resizewindow 1` has no confirmed Lua equivalent. Treat those as live-test/upstream gaps, not proven parity.

Known staged monitor gap: `monitor=...,hdr` maps to `bitdepth = 10` and `cm = "hdr"` in the parity checker, but those fields are currently commented in `lua/monitors.lua` pending live verification. Treat this as an explicit HDR API gap, not complete monitor parity.

Machine-specific `monitors.conf` remains gitignored for the live `.conf` config, but staged Lua mirrors known host layouts in tracked `lua/monitors.lua`. Current host-specific profile: `rvn-pc`.

Validate this phase with:

```bash
lua .config/hypr/hyprland.lua
```

Current validation status:

- Staged parity check passes with the known gaps above.
- Source graph audit passes; no active hyprlang source lines are currently uncategorized by the staged migration.
- Local Lua execution of `hyprland.lua` passes.

Keep `.config/hypr/hyprland.lua` as the live Lua test entrypoint. Remove or rename it to roll back to `.config/hypr/hyprland.conf`.

### 4. Convert `hypr-quickrule`

`.config/vicinae/extensions/hypr-quickrule/src/hypr-quickrule.tsx` writes Lua data at `~/.config/hypr/rules/generated.lua`.

Requirements:

- Write Lua data, not `hl.window_rule(...)` calls.
- Replace existing Lua entry with same `id`.
- Preserve the existing `.conf` append path until rollback support is retired.
- Keep profile effects normalized.
- Keep `Save Window State` behavior appending matchers to `rules/window-state-selectors.lua`; it triggers `hyprctl reload config-only` so `window-state.sh` refreshes rule outputs.
- Continue reloading Hyprland after writes while generated files are active.

### 5. Convert `window-state.sh`

Keep the daemon architecture unchanged initially:

- socket2 events
- adaptive polling while tracked floating windows exist
- monitor-relative coordinates
- debounced writes
- immediate save on close

Keep `rules/window-state-selectors.lua` as the writable selector source.

Dual-write generated rule outputs:

- Keep `window-state-rules.conf` for rollback to hyprlang config.
- Write `rules/window-state.lua` for Lua config.
- Keep both generated rule outputs ignored once Lua output is proven stable.

Keep a temporary compatibility mode or backup writer for the old `.conf` format until the Lua config has proven stable.

### 5.5. Retire Dispatcher Compatibility Fallbacks

IPC-heavy Bash helpers that need Lua-specific dispatcher syntax live under categorized `runtime/` area directories. Legacy `.config/hypr/scripts/` helpers are retained only under `legacy/` for reference.

Current Lua runtime helper areas:

- `lua/runtime/gamescope/` for Gamescope-specific profile and overlay automation.
- `lua/runtime/windows/` for show-desktop and minimize/restore workflows.
- `lua/runtime/session/` for session exit helpers used by Lua actions.
- `lua/runtime/startup/` for startup-only workspace routing that needs Lua-compatible dispatcher syntax.

Runtime helpers are categorized by behavior area under `runtime/`.

### 6. Validate Reload Behavior

Test generated file updates with:

- restart into Lua config
- update a quickrule
- update a tracked window state
- `hyprctl reload config-only`
- `hyprctl configerrors`
- verify generated files are re-read

If generated file reload behavior is stale, inspect whether the generated writer actually triggered a Hyprland reload and whether `lua/rule-loader.lua` is path-loading the generated data. Avoid `require` for generated files unless cache invalidation is explicit.

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
