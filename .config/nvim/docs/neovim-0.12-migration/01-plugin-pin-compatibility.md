# Plugin Pin Compatibility Migration Plan

## Scope

- `.config/nvim/lua/config/lazy.lua`
- `.config/nvim/lazy-lock.json`

## Goal

Make plugin revisions a non-blocker for Neovim 0.12 by identifying and updating only the pinned plugins most likely to break on the new core release.

## Why This Area Matters

This config is pinned through `lazy-lock.json`. Even if the Lua config is correct for 0.12, stale plugin revisions can still break startup, LSP behavior, diagnostics rendering, Treesitter queries, or UI integrations.

## Plan

1. Run a lockfile sanity pass before updating anything.
2. List plugins most exposed to Neovim 0.12 changes.
3. Split them into risk groups:
   - LSP
   - diagnostics
   - Treesitter
   - UI and cmdline
4. Check current pinned commits and branch strategy against known 0.12 compatibility fixes, issue threads, and plugin migration notes.
5. Update providers before wrappers:
   - `lazy.nvim`
   - `mason.nvim`
   - `nvim-lspconfig`
   - `nvim-treesitter`
6. Update only the minimum set of wrapper plugins needed after provider compatibility is established.
7. Re-test the affected feature group after each update batch.
8. Leave unrelated plugin pins untouched.

## Required Checks To Add

1. Confirm branch-level compatibility, not only commit age.
2. Treat `nvim-treesitter` as a branch strategy decision, not a normal version bump.
3. For plugins without stable releases, use upstream issue and README guidance rather than release notes alone.
4. Add a rollback checkpoint after each pin batch.

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
3. Run `:checkhealth` after each update batch.
4. Open representative filetypes and verify no plugin throws runtime errors.
5. Test one LSP action, one diagnostics jump, and one cmdline completion flow.
6. Confirm later migration work is no longer blocked by known stale pin issues.

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
- A provider update can expose latent wrapper-plugin issues that were previously hidden.
