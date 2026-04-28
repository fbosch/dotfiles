---
name: lua-config-authoring
description: Author, refactor, or review Lua used as program configuration in this dotfiles repo. Use when editing or evaluating Lua config layers such as .config/nvim/, .config/wezterm/, Hypr Lua helpers, or future Lua-backed dotfiles, especially shared Lua style, module layout, config table construction, event-oriented design, optional integration guards, startup/reload safety, host API boundaries, and consistency with scoped AGENTS.md guidance.
---

# Lua Config Authoring

## Overview

Write Lua config as small declarative modules with guarded imperative edges. Keep this skill host-agnostic; put layer-specific API rules in the nearest scoped `AGENTS.md` or referenced docs.

## Workflow

1. Identify host scope: Neovim, WezTerm, Hypr helper, or shared Lua module.
2. Read the nearest scoped `AGENTS.md` and any referenced local docs for host-specific rules.
3. Read the nearest existing module and entrypoint before editing.
4. Preserve local structure and indentation; do not reformat unrelated tables.
5. Prefer event-driven hooks, lazy triggers, and explicit user actions over startup work or polling.
6. Guard optional integrations, platform branches, external processes, and host API boundaries.
7. Run the smallest useful validation for the touched host config.

## Repo Patterns

- Keep entrypoints thin. Root config files should set bootstrap state, delegate to modules, then return or hand off.
- Put repeated `require(...)` aliases at the top of a file.
- Use `local M = {}` modules for reusable helpers; use private `local function` helpers.
- For host config modules, keep one concern per file and apply changes to the host-owned config/state object instead of inventing a wrapper framework.
- Use host-native declarative tables for options, plugin specs, key/action definitions, rules, and commands.
- Use existing local wrappers for recurring host operations when present instead of bypassing them.
- Prefer guard clauses and early returns over nested conditionals.
- Wrap optional plugins, external integrations, host object traversal, JSON/parsing, and fallible `require` boundaries with `pcall`.
- Keep comments rare and intent-focused: explain host constraints, ordering, performance, or non-obvious fallbacks.
- Preserve Danish letters exactly if editing strings or docs.

## General Lua Config Rules

- Prefer `local` for variables and functions unless a host API explicitly requires global state.
- Treat config files as declarative tables plus small imperative callbacks.
- Prefer simple tables, assignments, and functions over metatables, classes, factories, or coroutines.
- Use multiline tables with trailing commas for non-trivial config.
- Prefer double quotes unless the string contains double quotes.
- Keep module-level caches explicit, bounded, and justified by host behavior.
- Do not add compatibility layers unless persisted state, shipped behavior, external consumers, or the user requires it.
- Do not edit generated or state files such as `lazy-lock.json`.

## Cross-Layer Landmines

- Never call host reload/reconfigure APIs at file scope; reload-triggering calls belong behind guarded events, explicit commands, or user actions.
- Never write host config overrides without checking whether the value actually changed when the host can emit reload/change events.
- Never put expensive work in startup-always paths when the host supports lazy/event/cmd/key-triggered execution.
- Never swallow broad `pcall` failures silently when behavior changes materially; provide a fallback, notification, or narrow comment.
- Never introduce metatable/class/factory abstractions for config shape unless the existing layer already uses them or the host API requires it.
- Never convert an existing module style across a whole tree just because another host layer uses a different shape.
- Never broad-reformat Lua indentation or table layout while making behavioral edits.

## Layer-Specific Guidance

- Store host-specific API rules in the closest scoped `AGENTS.md` and referenced docs, not in this shared skill.
- If a Lua layer lacks an `AGENTS.md` and has non-obvious host constraints, add a small scoped file there instead of expanding this skill.
- Existing scoped guidance includes `.config/nvim/AGENTS.md`, `.config/wezterm/AGENTS.md`, and `.config/hypr/AGENTS.md`.
- First copy the layer's existing module/export shape, then improve locally.
- Keep shell command construction isolated and named; avoid embedding complex scripts in Lua strings when a script file already fits the repo pattern.
- Treat host state, generated files, and reload side effects as boundaries that need guards.

## Style Decisions

- Indentation in this repo has mixed evidence: local docs say 2 spaces, while some sampled Lua files use tabs. Do not churn indentation. Match the surrounding file; use 2 spaces for new standalone Neovim Lua unless nearby code indicates otherwise.
- Keep line wrapping consistent with nearby code. Prefer readable multiline tables over dense one-liners.
- Use `snake_case` for functions and local names in repo Lua.
- Use compact local aliases where already established (`map`, `cmd`, `group`, `wezterm`, `act`).

## Review Checklist

- Does the edit match the host's existing module shape?
- Does startup work stay minimal and lazy where possible?
- Are optional integrations guarded with useful fallback behavior?
- Are event hooks used instead of polling?
- Are globals avoided unless required by the host?
- Are reload/change loops impossible around host override APIs?
- Did host-specific setup/API rules come from the scoped `AGENTS.md` or local docs?
- Are keymaps/actions/user commands using existing helpers where available?
- Did validation target the smallest relevant scope?

## Validation

- Prefer existing project validation workflows when present.
- For Neovim changes, use the smallest relevant startup/headless check or repo workflow.
- For WezTerm changes, use the smallest available config/syntax check or repo workflow.
- For other Lua config layers, run the layer's parser/check command if present; otherwise run the narrow script/module check that exercises the changed code path.
- If validation needs unavailable host binaries, report that explicitly and include the files reviewed.

## Source Basis

- Lua: locals, lexical scope, tables, and `pcall` from the Lua reference manual.
- Lua style: local-by-default, small scopes, trailing commas, and intent comments from the LuaRocks Lua Style Guide.
- Host-specific API rules should live in scoped `AGENTS.md` files and their referenced docs.
