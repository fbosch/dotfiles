# Neovim Configuration - Agent Guide

Neovim config with Lazy.nvim, Lua-first modules, and VSCode-mode support.

## Essentials

- Lazy.nvim plugin system is bootstrapped in `lua/config/lazy.lua`.
- Plugin specs live under `lua/plugins/` and are imported via `lua/plugins/init.lua`.
- VSCode mode (`vim.g.vscode`) loads `lua/config/vscode.lua` and disables most UI plugins.
- Neovim state lives in `.config/nvim/.undo`, `.backup`, `.sessions`, `.swp` (do not edit directly).

## More Guidance

- [Local structure and entrypoints](docs/agents/structure.md)
- [Options, autocmds, and keymaps](docs/agents/behavior.md)
- [User commands and utils](docs/agents/utils.md)
- [Plugin layout](docs/agents/plugins.md)
- [VSCode mode](docs/agents/vscode.md)
- [Lua style (shared)](../../docs/agents/nvim-lua.md)
- [File organization (shared)](../../docs/agents/file-organization.md)
