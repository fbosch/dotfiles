---
name: hypr-config
description: Configure and troubleshoot the active Hyprland Lua configuration in this dotfiles repo. Use when changing monitors, binds, input, workspaces, window or layer rules, layouts, animations, environment, startup, or runtime behavior under `.config/hypr/`, or when diagnosing regressions against the locally recorded Hyprland 0.56.0 runtime. The active graph starts at `hyprland.lua`; Hyprlang `.conf` files are legacy rollback material.
---

# Hypr Config

## Scope

The active compositor configuration is the Lua graph rooted at `.config/hypr/hyprland.lua`. `.conf` files are legacy Hyprlang rollback material unless the task explicitly targets a rollback. Treat `.config/hypr/docs/agents/` as the canonical local reference.

Use `.config/hypr/docs/agents/version.md` as the documentation baseline and confirm the locally installed runtime with `hyprctl version` before relying on version-specific behavior. The current local baseline is Hyprland 0.56.0.

Edit only the smallest relevant Lua module or sourced data file. Keep the repo's split-config layout.

## Activation Boundaries

Use this skill for Hyprland configuration or runtime behavior under `.config/hypr/`.

Do not use this skill for generic Nix/Home Manager refactors unless the task includes Hyprland behavior or diagnostics.

## Required Workflow

1. Read the active config structure first:
   - `.config/hypr/docs/agents/structure.md`
   - `.config/hypr/docs/agents/lua-configuration.md`
2. Confirm the runtime and documentation baseline:
   - `hyprctl version`
   - `.config/hypr/docs/agents/version.md`
3. When troubleshooting, classify the issue before editing:
   - Lua parse/config error
   - layer/input/stacking behavior
   - runtime regression after reload
   - legacy Hyprlang rollback work
4. Confirm exact Lua API, options, and event semantics in the local docs before changing behavior.
5. Apply minimal edits in the appropriate Lua module or generated-data source.
6. Validate active Lua changes with:
   - `hyprctl configerrors`
   - `just lua-quality changed` when Lua files changed
   - `just hypr-validate` for the compositor error check
7. Reload only when needed with `hyprctl reload`. Use `hyprctl reload full-reset` only when explicitly testing a switch between Lua and legacy Hyprlang.

If `hyprctl configerrors` reports issues, fix them before further tuning. Do not treat a legacy `.conf` check as validation of the active Lua graph.

## Lua Runtime Commands

For temporary active-config experiments, prefer:

- `hyprctl eval 'hl.config(...)'` for Lua configuration values
- `hyprctl eval 'hl.dispatch(...)'` for Lua dispatchers
- `hyprctl repl` to inspect the live Lua API
- `hyprctl getoption <section.option>` for effective option values

`hyprctl keyword` is the legacy Hyprlang path. Do not use it as the persistence mechanism for the active Lua configuration. Runtime experiments are temporary; persist successful behavior in the sourced Lua module.

## Pi Runtime Tools

For read-only runtime verification, start with `hypr_desktop_diagnose`. It returns one snapshot of compositor and runtime state and records source failures under `unavailable`; treat missing sources as unknown.

Use `hypr_layer_inspect` for namespace, monitor, level, or geometry details beyond the desktop snapshot. Its filters are exact matches and its result is bounded.

Use `/hypr-prop` for interactive window selection. When the window address is known, use `/hypr-prop --id <0xaddress>` to avoid selecting the wrong window.

Use `hypr_window_screenshot` only when visual evidence is necessary. Prefer an explicit region or the smallest useful capture mode.

All three tools respect Hyprland privacy boundaries. Windows and layer-shell entries marked with `privacy` or `no_screen_share` are redacted. Do not bypass that redaction with raw client queries or alternate capture commands.

## Failure Decision Tree

1. If `hyprctl configerrors` is non-empty, fix Lua syntax or rules first.
2. If the symptom is layer, input, or overlay behavior, inspect:
   - `hyprctl layers`
   - `hypr_layer_inspect`
   - `hypr_desktop_diagnose`
   - `.config/hypr/docs/agents/layer-rules.md`
   - `.config/hypr/docs/agents/references/core/rules/layer-rules.md`
3. If the symptom appears only after reload or startup, inspect live logs:
   - `hyprctl rollinglog -f`
   - `.config/hypr/docs/agents/references/core/advanced-configuration/events.md`
4. If the issue is a legacy rollback, verify that the task explicitly selected the Hyprlang graph and do not mix it with the active Lua validation path.
5. If unresolved, return the smallest next diagnostic step and required evidence.

## Authoring Rules

- Use the Lua APIs documented in `lua-configuration.md`; do not translate new changes into Hyprlang syntax just because a rollback `.conf` file contains a similar rule.
- Prefer `require` for stable hand-written modules and `dofile` for generated data that must be re-read.
- Keep generated rule data under the existing generated sources and preserve declaration order: generated rules, static rules, then window-state rules.
- Respect comma-separated argument counts in Lua tables and calls. Empty arguments still require separators where the API expects them.
- Keep rule order intentional. Rules are evaluated top to bottom.
- Distinguish static and dynamic window effects: static effects apply on window creation; dynamic effects can be adjusted at runtime.
- Prefer explicit match properties and stable selectors over broad regex rules.
- Keep Lua runtime helpers non-blocking; use asynchronous `hl.dsp.exec_cmd(...)` for external commands.

## Reference Loading Strategy

Load only the local reference relevant to the task:

- Lua config and module loading: `.config/hypr/docs/agents/lua-configuration.md`
- Base options: `.config/hypr/docs/agents/references/core/config-options.md`
- Keywords and runtime Lua control: `.config/hypr/docs/agents/references/core/advanced-configuration/using-hyprctl.md`
- Binds and submaps: `.config/hypr/docs/agents/references/core/binds/_index.md`, `flags.md`, and `.config/hypr/docs/agents/references/core/dispatchers.md`
- Window and layer behavior: `.config/hypr/docs/agents/references/core/rules/window-rules.md` and `layer-rules.md`
- Workspace policy: `.config/hypr/docs/agents/references/core/rules/workspace-rules.md`
- Monitor setup and scaling: `.config/hypr/docs/agents/references/core/monitors/_index.md`
- Layout-specific tuning: `.config/hypr/docs/agents/references/layouts/dwindle-layout.md`, `master-layout.md`, `monocle-layout.md`, or `scrolling-layout.md`

Escalate to upstream docs only when local docs do not cover the behavior.

## Runtime-Safe Iteration

When testing behavior, prefer temporary runtime changes first, then persist in config:

- `hyprctl eval 'hl.config(...)'` for option experiments
- `hyprctl dispatch 'hl.dsp.focus({ workspace = "3" })'` for behavior checks
- `hyprctl getoption <section:option>` for effective values

Batch multiple runtime operations when possible with `hyprctl --batch`. Avoid high-frequency `hyprctl` loops; it is synchronous.

## Output Contract

For ordinary configuration changes, report the files inspected or edited, the changes made, and validation commands with key results.

When troubleshooting, return these five items:

1. symptom bucket
2. files inspected or edited
3. commands run with key results
4. root-cause hypothesis with confidence
5. smallest next safe step

## Repo Notes

- Scripts referenced by config should use full path style consistent with this repo (`~/.config/hypr/runtime/<area>/...`).
- If scripts are introduced or moved, keep executable bit correct.
