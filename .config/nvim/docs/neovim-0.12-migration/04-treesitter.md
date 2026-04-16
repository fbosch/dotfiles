# Treesitter Migration Plan

## Scope

- `.config/nvim/lua/plugins/core/treesitter.lua`
- `.config/nvim/lua/config/opts.lua`
- `.config/nvim/lua/plugins/core/completion.lua`
- Treesitter-related entries in `.config/nvim/lazy-lock.json`

## Goal

Make Treesitter-dependent highlighting, folding, and completion logic work correctly on Neovim 0.12.

## Why This Area Matters

Neovim 0.12 includes Treesitter API and query changes that can affect custom query logic, parser behavior, and old fold integration patterns. This config uses Treesitter directly for setup and indirectly in completion and folding behavior.

This area also has a likely branch-level compatibility decision in the current lockfile, which makes it more than a normal plugin update.

## Plan

1. Decide the `nvim-treesitter` branch strategy before deeper debugging.
2. Inventory Treesitter setup, parser config, and query-dependent behavior.
3. Confirm Treesitter is not lazy-loaded.
4. Replace or validate any legacy foldexpr path such as `nvim_treesitter#foldexpr()`.
5. Consider whether `vim.treesitter.foldexpr()` should replace the legacy path.
6. Audit Treesitter capture and query helpers used by completion or textobject-style logic.
7. Check pinned `nvim-treesitter` revision for compatibility with Neovim 0.12.
8. Run `:TSUpdate` after any plugin pin change.
9. Validate common language paths including markdown, comments, folds, injections, and fenced code blocks.

## Required Checks To Add

1. Resolve branch strategy before assuming query errors are local config bugs.
2. Treat `:TSUpdate` as mandatory after Treesitter plugin changes.
3. Check for query API assumptions that changed in 0.12.
4. Validate injection-heavy paths, not only plain syntax highlighting.

## Validation

1. Open representative files such as Lua, TypeScript, and Markdown.
2. Confirm syntax highlighting remains correct.
3. Confirm fold creation and fold opening behave as expected.
4. Confirm completion logic still handles comment context correctly.
5. Confirm markdown fenced code blocks and other injections still highlight correctly.
6. Check for query warnings or runtime errors during editing.

## Done When

- No Treesitter query or parser warnings appear in normal use.
- Folding works with the chosen integration path.
- Completion and comment detection still use correct syntax context.
- Main languages in this setup render correctly.

## Likely Grep Targets

- `nvim-treesitter`
- `nvim_treesitter#foldexpr`
- `vim.treesitter.foldexpr`
- `in_treesitter_capture`
- `foldexpr`
- `TSUpdate`

## Risks

- A Treesitter issue may appear only in specific languages or query groups.
- Fold migration can change behavior even when it does not produce hard errors.
- Branch mismatch can make the whole migration look broken before config is actually tested.
