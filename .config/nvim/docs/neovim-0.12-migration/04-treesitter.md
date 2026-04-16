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

## Plan

1. Inventory Treesitter setup, parser config, and query-dependent behavior.
2. Replace or validate any legacy foldexpr path such as `nvim_treesitter#foldexpr()`.
3. Audit Treesitter capture and query helpers used by completion or textobject-style logic.
4. Check pinned `nvim-treesitter` revision for compatibility with Neovim 0.12.
5. Validate common language paths including markdown, comments, and folds.

## Validation

1. Open representative files such as Lua, TypeScript, and Markdown.
2. Confirm syntax highlighting remains correct.
3. Confirm fold creation and fold opening behave as expected.
4. Confirm completion logic still handles comment context correctly.
5. Check for query warnings or runtime errors during editing.

## Done When

- No Treesitter query or parser warnings appear in normal use.
- Folding works with the chosen integration path.
- Completion and comment detection still use correct syntax context.
- Main languages in this setup render correctly.

## Likely Grep Targets

- `nvim-treesitter`
- `nvim_treesitter#foldexpr`
- `in_treesitter_capture`
- `foldexpr`
- `TSUpdate`

## Risks

- A Treesitter issue may appear only in specific languages or query groups.
- Fold migration can change behavior even when it does not produce hard errors.
