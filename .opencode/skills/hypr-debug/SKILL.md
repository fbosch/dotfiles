---
name: hypr-debug
description: Diagnose and fix Hyprland runtime problems in this dotfiles repo. Use when behavior is wrong despite valid config, including layer-shell stacking/input issues, missing keybind effects, monitor/workspace anomalies, window-rule mismatches, startup race failures, and regressions after reload on Hyprland v0.52.0.
---

# Hypr Debug

## Scope

Treat `.config/hypr/docs/agents/` as the canonical local reference for this repo.
Target Hyprland version: `0.52.0`.

This skill is for runtime diagnosis and correction, not broad config redesign.

## Activation Boundaries

Use this skill when symptoms are behavioral or runtime-first:

- keybind dispatches do nothing or target wrong windows/workspaces
- layer-shell surfaces are hidden, unfocusable, or click-through
- monitor/workspace routing is inconsistent with expectations
- behavior regresses after `hyprctl reload` or session start

Do not use this skill for purely cosmetic theme edits without runtime failures.

## Required Workflow

1. Classify symptom bucket first:
   - parse/config error
   - layer/input/stacking
   - bind/dispatcher path
   - monitor/workspace routing
   - startup/reload regression
2. Run minimum diagnostics for the bucket.
3. Form one falsifiable hypothesis.
4. Apply the smallest possible fix.
5. Re-run diagnostics and confirm before/after evidence.

If a config edit is made during debugging, run `hyprctl configerrors` before continuing.

## Failure Decision Tree

1. If `hyprctl configerrors` is non-empty, resolve that first.
2. If bind or action mismatch, inspect:
   - `.config/hypr/docs/agents/references/Binds.md`
   - `.config/hypr/docs/agents/references/Dispatchers.md`
   - `hyprctl clients`
3. If layer-shell behavior is wrong, inspect:
   - `hyprctl layers`
   - `.config/hypr/docs/agents/layer-rules.md`
   - `.config/hypr/docs/agents/references/Window-Rules.md`
4. If monitor/workspace behavior is wrong, inspect:
   - `.config/hypr/docs/agents/references/Monitors.md`
   - `.config/hypr/docs/agents/references/Workspace-Rules.md`
5. If startup/reload regression persists, inspect live logs during repro:
   - `hyprctl rollinglog -f`
6. If unresolved, return smallest next diagnostic action and required evidence.

## Diagnostics Baseline

Use the smallest command set that can prove or disprove the current hypothesis:

- `hyprctl clients`
- `hyprctl layers`
- `hyprctl rollinglog -f`
- `hyprctl getoption <section:option>`

Prefer event-driven approaches over polling when building ongoing diagnostics.
Avoid loops that call synchronous `hyprctl` frequently.

## NEVER

- Never start with broad config rewrites before symptom classification.
- Never run repeated reload loops without capturing new evidence.
- Never mix multiple unrelated fixes in one debug cycle.
- Never assume layer order from app names; verify namespace/order explicitly.
- Never claim resolved unless a concrete repro no longer fails.

## Reference Loading Strategy

Load local docs first, then escalate only if missing:

- `.config/hypr/docs/agents/debugging.md` for command-first triage.
- `.config/hypr/docs/agents/pitfalls.md` for common syntax and script traps.
- `.config/hypr/docs/agents/layer-rules.md` for namespace/order debugging.
- `.config/hypr/docs/agents/references/Using-hyprctl.md` for runtime semantics.
- `.config/hypr/docs/agents/references/Window-Rules.md` for rule matching/precedence.
- `.config/hypr/docs/agents/references/Binds.md` and `.config/hypr/docs/agents/references/Dispatchers.md` for input paths.
- `.config/hypr/docs/agents/references/Monitors.md` and `.config/hypr/docs/agents/references/Workspace-Rules.md` for routing/state.

## Output Contract

Return exactly these five items:

1. symptom bucket
2. hypothesis and confidence
3. commands run with key evidence
4. fix applied (or why not)
5. verification result and next smallest step

## Repo Notes

- Hypr config is split; touch only the relevant sourced file under `.config/hypr/`.
- Keep script references consistent with repo style (`~/.config/hypr/scripts/...`) and ensure executability when relevant.
