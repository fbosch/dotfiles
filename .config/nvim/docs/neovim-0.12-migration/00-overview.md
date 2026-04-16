# Neovim 0.12 Migration Overview

This directory breaks the Neovim 0.12 upgrade into separate migration areas so each one can be handled, validated, and committed independently.

## Migration Order

1. `01-plugin-pin-compatibility.md`
2. `02-lsp-stack.md`
3. `03-diagnostics-and-signs.md`
4. `04-treesitter.md`
5. `05-ui-statusline-cmdline.md`
6. `06-shell-execution.md`
7. `07-local-config-exrc.md`

## Why This Order

- Plugin compatibility first removes false negatives caused by stale pinned revisions.
- LSP, diagnostics, and Treesitter carry the highest break risk in this setup.
- UI and shell behavior are easier to validate after core editor behavior is stable.
- Local config and `exrc` are a policy decision, not a core runtime blocker.

## Shared Validation Approach

Each migration area should follow the same loop:

1. Inventory current config and plugin touchpoints.
2. Change only the minimum needed for that area.
3. Run focused runtime checks for that area.
4. Stop before the next migration area unless the current one depends on it.

## Files Most Likely To Be Touched

- `.config/nvim/lazy-lock.json`
- `.config/nvim/lua/plugins/core/lsp.lua`
- `.config/nvim/lua/config/keymaps/lsp.lua`
- `.config/nvim/lua/config/keymaps/navigation.lua`
- `.config/nvim/lua/plugins/core/treesitter.lua`
- `.config/nvim/lua/config/opts.lua`
- `.config/nvim/lua/plugins/ui/statusline.lua`
- `.config/nvim/lua/plugins/ui/wildmenu.lua`
- `.config/nvim/lua/utils/terminal.lua`

## Notes

- These plans are scoped for this repo's current Neovim setup.
- They are written to support one migration at a time, not a full upgrade rewrite.
- A migration may still reveal plugin-specific issues that require pin updates or follow-up cleanup.
