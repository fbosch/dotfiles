# Neovim Configuration - Agent Guide

Neovim config with Lazy.nvim, Lua-first modules, and VSCode-mode support.

## Essentials

- VSCode mode (`vim.g.vscode`) loads `lua/config/vscode.lua` and disables most UI plugins.
- Neovim state dirs (`.undo`, `.backup`, `.sessions`, `.swp`) are generated — do not edit directly.

## More Guidance

- [Local structure and entrypoints](docs/agents/structure.md)
- [Options, autocmds, and keymaps](docs/agents/behavior.md)
- [User commands and utils](docs/agents/utils.md)
- [Plugin layout](docs/agents/plugins.md)
- [VSCode mode](docs/agents/vscode.md)
- [Lua style (shared)](../../docs/agents/nvim-lua.md)
- [File organization (shared)](../../docs/agents/file-organization.md)
