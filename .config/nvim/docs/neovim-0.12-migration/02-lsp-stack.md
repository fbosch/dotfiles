# LSP Stack Migration Plan

## Scope

- `.config/nvim/lua/plugins/core/lsp.lua`
- `.config/nvim/lua/config/keymaps/lsp.lua`
- `.config/nvim/lua/plugins/ui/hlargs.lua`
- LSP-related entries in `.config/nvim/lazy-lock.json`

## Goal

Make the LSP stack behave cleanly on Neovim 0.12 without duplicate built-in behavior, broken commands, or plugin regressions.

## Why This Area Matters

Neovim 0.12 expands built-in LSP functionality, adds more defaults, and changes some command and semantic-token expectations. This setup has a heavily customized LSP layer with multiple plugins on top of core LSP behavior.

## Plan

1. Inventory every direct `vim.lsp` usage, `LspAttach` hook, and per-server override.
2. Identify legacy `require("lspconfig").SERVER.setup()` usage and treat it as an explicit migration target.
3. Audit custom keymaps against new 0.12 defaults such as `grt`, `grx`, and the `:lsp` command family.
4. Validate load order for LSP config definitions before enable or attach paths run.
5. Check semantic-token behavior and any highlight interactions with UI plugins or colors.
6. Review capability-driven logic such as formatting, codelens, inlay hints, linked editing, and code actions.
7. Verify plugin compatibility for `nvim-lspconfig`, `lspsaga.nvim`, and `typescript-tools.nvim`.
8. Ensure TypeScript has one source of truth so `typescript-tools.nvim` does not overlap with `ts_ls`, `tsserver`, or similar config.
9. Run runtime validation in at least a few real filetypes.

## Required Checks To Add

1. No legacy `require("lspconfig").SERVER.setup()` remains in the active path after migration.
2. `:lsp enable`, `:lsp disable`, and `:lsp restart` must work.
3. No duplicate TypeScript clients attach to the same buffer.
4. `LspAttach` should still run once per client and buffer.

## Validation

1. Open a TypeScript or Lua file.
2. Test `:lsp enable`, `:lsp disable`, and `:lsp restart`.
3. Test hover, rename, code action, diagnostics navigation, references, and restart behavior.
4. Confirm no duplicate keymaps or duplicate UI surfaces appear.
5. Confirm `LspAttach` logic still runs once per client and buffer as intended.
6. Confirm semantic highlighting looks intentional rather than doubled or noisy.
7. Confirm only one TypeScript client attaches where expected.

## Done When

- LSP commands work on 0.12.
- No custom map conflicts with 0.12 defaults in a harmful way.
- Semantic-token behavior is either accepted or explicitly controlled.
- Core LSP workflows work through both built-in paths and wrapper plugins.

## Likely Grep Targets

- `vim.lsp`
- `LspAttach`
- `server_capabilities`
- `semantic_tokens`
- `inlay_hint`
- `:lsp`
- `lspsaga`
- `typescript-tools`

## Risks

- Some breakage here may actually be caused by stale plugin pins.
- Semantic-token regressions may be visual only and easy to miss without real file testing.
- `lspsaga.nvim` may need special attention because 0.12-related window behavior changes can surface there first.
