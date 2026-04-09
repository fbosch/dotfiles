---
name: hypr-config
description: Configure and troubleshoot Hyprland safely in this dotfiles repo. Use when adding or changing monitor, bind, input, workspace, window rule, layer rule, layout, animation, env, startup, or runtime behavior in `.config/hypr/*.conf`, and when diagnosing config errors, layer-shell stacking/input issues, or post-reload regressions for Hyprland v0.52.0.
---

# Hypr Config

## Scope

Treat `.config/hypr/docs/agents/` as the canonical local reference for this repo.
Target Hyprland version: `0.52.0`.

Edit only the smallest relevant config file. Keep the repo's split-config layout.

## Activation Boundaries

Use this skill for Hyprland config/runtime behavior.

Do not use this skill for generic Nix/Home Manager refactors unless the task includes Hyprland behavior or diagnostics.

## Required Workflow

1. Read the active config structure first:
   - `.config/hypr/docs/agents/structure.md`
2. Classify the issue before editing:
   - parse/syntax errors
   - layer/input/stacking behavior
   - runtime regression after reload
3. Confirm exact syntax and options in local docs before changing behavior.
4. Apply minimal edits in the appropriate sourced file.
5. Validate every `.conf` change with:
   - `hyprctl configerrors`
6. Reload only when needed:
   - `hyprctl reload`

If `hyprctl configerrors` reports issues, fix them before any further tuning.

## Failure Decision Tree

1. If `hyprctl configerrors` is non-empty, fix syntax/rules first.
2. If symptom is layer/input/overlay behavior, inspect:
   - `hyprctl layers`
   - `hyprctl clients`
   - `.config/hypr/docs/agents/layer-rules.md`
3. If symptom appears only after reload/startup, inspect live logs:
   - `hyprctl rollinglog -f`
4. If unresolved, return the smallest next diagnostic step and required evidence.

## NEVER

- Never skip `hyprctl configerrors` after editing `.conf` files.
- Never bundle unrelated config changes before a validation cycle.
- Never claim a fix without command evidence tied to the symptom.
- Never use broad regex selectors when a stable explicit selector is available.
- Never rely on high-frequency `hyprctl` polling loops; `hyprctl` is synchronous.

## Authoring Rules

- Respect comma-separated argument counts. Empty arguments still require separators.
- Use block nesting for subcategories (`general { snap { ... } }`), not `general:snap {`.
- Keep rule order intentional. Rules are evaluated top to bottom.
- Remember precedence: named rules evaluate before anonymous rules.
- Distinguish static and dynamic window effects:
  - static effects apply on window creation
  - dynamic effects can be adjusted at runtime (including with `setprop`)
- Prefer explicit `match:` props and stable selectors over broad regex rules.

## Reference Loading Strategy

Load local docs first. Use these paths directly:

- `.config/hypr/docs/agents/pitfalls.md` for syntax traps and script-path pitfalls.
- `.config/hypr/docs/agents/debugging.md` for first-line diagnostics.
- `.config/hypr/docs/agents/references/Variables.md` for option types/defaults.
- `.config/hypr/docs/agents/references/Keywords.md` for config keywords and sourcing.
- `.config/hypr/docs/agents/references/Binds.md` and `.config/hypr/docs/agents/references/Dispatchers.md` for key handling.
- `.config/hypr/docs/agents/references/Window-Rules.md` for window/layer rule behavior.
- `.config/hypr/docs/agents/references/Workspace-Rules.md` for workspace policies.
- `.config/hypr/docs/agents/references/Monitors.md` for monitor setup/scaling.
- `.config/hypr/docs/agents/references/Using-hyprctl.md` for runtime control semantics.

Escalate to upstream docs only when local docs do not cover the behavior.

## Config Decision Guide

- **Monitors and scaling:** `.config/hypr/docs/agents/references/Monitors.md`.
- **Base options and types:** `.config/hypr/docs/agents/references/Variables.md`.
- **Keywords and sourcing:** `.config/hypr/docs/agents/references/Keywords.md`.
- **Binds and submaps:** `.config/hypr/docs/agents/references/Binds.md` + `.config/hypr/docs/agents/references/Dispatchers.md`.
- **Window behavior:** `.config/hypr/docs/agents/references/Window-Rules.md`.
- **Layer behavior (bars/notifications/overlays):** `.config/hypr/docs/agents/references/Window-Rules.md` (Layer Rules section).
- **Workspace policy/default monitor/layout:** `.config/hypr/docs/agents/references/Workspace-Rules.md`.
- **Layout-specific tuning:** `.config/hypr/docs/agents/references/Dwindle-Layout.md`, `.config/hypr/docs/agents/references/Master-Layout.md`, `.config/hypr/docs/agents/references/Monocle-Layout.md`, `.config/hypr/docs/agents/references/Scrolling-Layout.md`.
- **Runtime control via CLI:** `.config/hypr/docs/agents/references/Using-hyprctl.md`.

## Runtime-Safe Iteration

When testing behavior, prefer temporary runtime changes first, then persist in config:

- `hyprctl keyword ...` for option experiments
- `hyprctl dispatch ...` for behavior checks
- `hyprctl getoption ...` for effective values

Batch multiple runtime operations when possible with `hyprctl --batch`.
Avoid high-frequency `hyprctl` loops; it is synchronous.

## Output Contract

Return these five items:

1. symptom bucket
2. files inspected or edited
3. commands run with key results
4. root-cause hypothesis with confidence
5. smallest next safe step

## Repo Notes

- Scripts referenced by config should use full path style consistent with this repo (`~/.config/hypr/scripts/...`).
- If scripts are introduced or moved, keep executable bit correct.
