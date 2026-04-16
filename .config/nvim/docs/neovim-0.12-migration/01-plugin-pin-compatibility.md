# Plugin Pin Compatibility Migration Plan

## Scope

- `.config/nvim/lua/config/lazy.lua`
- `.config/nvim/lazy-lock.json`

## Goal

Make plugin revisions a non-blocker for Neovim 0.12 by identifying and updating only the pinned plugins most likely to break on the new core release.

## Why This Area Matters

This config is pinned through `lazy-lock.json`. Even if the Lua config is correct for 0.12, stale plugin revisions can still break startup, LSP behavior, diagnostics rendering, Treesitter queries, or UI integrations.

## Plan

1. List plugins most exposed to Neovim 0.12 changes.
2. Split them into risk groups:
   - LSP
   - diagnostics
   - Treesitter
   - UI and cmdline
3. Check current pinned commits against known 0.12 compatibility fixes or release notes.
4. Update only the minimum set of plugins needed for compatibility.
5. Re-test the affected feature group after each update batch.
6. Leave unrelated plugin pins untouched.

## Priority Plugins

- `nvim-lspconfig`
- `nvim-treesitter`
- `lspsaga.nvim`
- `typescript-tools.nvim`
- `trouble.nvim`
- `wilder.nvim`
- `snacks.nvim`

## Validation

1. Start Neovim without startup errors.
2. Confirm lazy can resolve and load all pinned plugins cleanly.
3. Open representative filetypes and verify no plugin throws runtime errors.
4. Confirm later migration work is no longer blocked by known stale pin issues.

## Done When

- `lazy-lock.json` no longer contains obviously incompatible pins for 0.12-sensitive plugins.
- Startup is clean enough to continue with focused migrations.
- New runtime failures can be attributed to config behavior rather than stale plugin revisions.

## Likely Grep Targets

- `lazy-lock.json`
- plugin names in `lua/plugins/`
- `lazy.nvim`

## Risks

- Updating too many pins at once makes root cause hard to isolate.
- A plugin pin refresh may force a config change in a later migration area.
