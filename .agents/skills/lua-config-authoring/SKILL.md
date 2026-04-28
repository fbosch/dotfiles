---
name: lua-config-authoring
description: Author, refactor, or review Lua used as program configuration in this dotfiles repo. Use when editing or evaluating Lua under .config/nvim/ or .config/wezterm/, especially module layout, lazy.nvim specs, Neovim keymaps/autocmds/LSP config, WezTerm config modules/events/key bindings/status hooks, optional integrations, startup performance, or repo Lua style consistency.
---

# Lua Config Authoring

## Overview

Write Lua config as small declarative modules with guarded imperative edges. Match the local file's style first; improve reliability and startup behavior without broad rewrites.

## Workflow

1. Identify host scope: Neovim, WezTerm, or shared Lua helper.
2. Read the nearest existing module and entrypoint before editing.
3. Preserve local structure and indentation; do not reformat unrelated tables.
4. Prefer event-driven hooks and lazy triggers over startup work or polling.
5. Guard optional integrations, platform branches, and host API boundaries.
6. Run the smallest useful validation for the touched host config.

## Repo Patterns

- Keep entrypoints thin. `.config/wezterm/wezterm.lua` and `.config/nvim/init.lua` should delegate to modules.
- Put repeated `require(...)` aliases at the top of a file.
- Use `local M = {}` modules for reusable helpers; use private `local function` helpers.
- Use WezTerm concern modules that apply changes to one shared config object. Existing style often returns `function(config) ... end`; for larger new modules, `M.apply_to_config(config)` is also acceptable when clearer.
- Use lazy.nvim plugin spec tables for Neovim plugins, grouped by existing category under `.config/nvim/lua/plugins/`.
- Use existing wrappers for Neovim maps and commands: `require("utils").set_keymap()` and `require("utils").set_usrcmd()`.
- Prefer guard clauses and early returns over nested conditionals.
- Wrap optional plugins, external integrations, mux/window/pane calls, JSON/parsing, and fallible `require` boundaries with `pcall`.
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

## Neovim Rules

- For detailed local style, read `docs/agents/nvim-lua.md` before non-trivial Neovim Lua edits.
- Plugin files return lazy.nvim spec tables. Prefer `opts = { ... }` for ordinary setup.
- Use `config = function(_, opts)` only when setup needs custom logic, sequencing, callbacks, or fallback handling.
- Use `init` only for startup-required globals/settings; it always runs during startup.
- Add precise lazy triggers (`event`, `cmd`, `ft`, `keys`) unless a plugin must load eagerly.
- Defer heavy or optional `require(...)` calls into callbacks, config functions, commands, or key handlers.
- Use `vim.api.nvim_create_autocmd` with groups and Lua callbacks for event behavior.
- Use `LspAttach` for buffer-local LSP mappings/behavior when possible.
- Avoid synchronous external processes during startup.
- Gate VSCode-specific behavior with `vim.g.vscode`, `cond`, or early returns.

## WezTerm Rules

- Build one config via `require("wezterm").config_builder()` and return it from the root config.
- Keep modules scoped by concern: base, keys, colors, fonts, status, tabs, layout, platform, integrations.
- Use `wezterm.action.*` objects for key bindings; keep key tables declarative.
- Register runtime behavior with `wezterm.on(...)`; avoid custom polling loops.
- Use `status_update_interval` intentionally and avoid too-frequent callbacks.
- Guard optional `wezterm.plugin.require`, mux/window/pane traversal, and platform-dependent APIs.
- Never call `wezterm.reload_configuration()` at file scope.
- Guard `window:set_config_overrides(...)` with equality checks because it can trigger reload events.
- Use `wezterm.GLOBAL` only for intentional state that must persist across config reload/evaluation contexts.
- Consider `config:set_strict_mode(true)` only when fail-fast validation is worth cross-version strictness.

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
- Are globals avoided unless required by Neovim/WezTerm?
- Are reload loops impossible in WezTerm event/config override code?
- Are lazy.nvim `opts`, `config`, and `init` used for their intended roles?
- Are keymaps/user commands using existing helpers where available?
- Did validation target the smallest relevant scope?

## Validation

- For WezTerm syntax/config checks, prefer the existing project workflow if present; otherwise use the smallest available WezTerm config validation command.
- For Neovim changes, validate with the smallest relevant startup/headless command or existing repo workflow.
- If validation needs unavailable host binaries, report that explicitly and include the files reviewed.

## Source Basis

- Lua: locals, lexical scope, tables, and `pcall` from the Lua reference manual.
- Lua style: local-by-default, small scopes, trailing commas, and intent comments from the LuaRocks Lua Style Guide.
- Neovim: Lua `require`, protected `require`, autocmd callbacks, and LSP attach patterns from official Neovim docs.
- lazy.nvim: plugin spec fields, `opts`, `config`, `init`, and lazy triggers from official lazy.nvim docs.
- WezTerm: `config_builder`, helper modules, config reload behavior, events, strict mode, and override-loop cautions from official WezTerm docs.
