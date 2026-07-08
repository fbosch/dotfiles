# Neovim Configuration

Lua Neovim configuration using Lazy.nvim, modular config files, and a smaller VSCode-mode path.

## Entry Points

- `init.lua` sets the leader keys and loads `lua/config/init.lua`.
- `lua/config/init.lua` loads options, commands, highlights, keymaps, plugins, and runtime behavior.
- `lua/config/lazy.lua` bootstraps Lazy.nvim.
- `lua/config/vscode.lua` is used when `vim.g.vscode` is set.

## Layout

- `lua/config/` contains editor behavior: options, autocmds, abbreviations, colors, user commands, keymaps, and highlight groups.
- `lua/plugins/` groups plugin specs by purpose: `ai`, `core`, `lang`, `misc`, `ui`, and `workflow`.
- `lua/utils/` contains reusable Lua helpers for agents, formatting, Git, Kagi, layout, platform checks, projects, sessions, terminal behavior, VSCode, web actions, and yanking.
- `snippets/` contains editor snippets.
- `spell/` contains English and Danish spell additions.
- `docs/agents/` contains deeper guidance for editing this config.

## Notes

- VSCode mode should avoid loading normal UI plugins.
- Generated state directories such as `.undo`, `.backup`, `.sessions`, and `.swp` should not be edited directly.
- Do not edit `lazy-lock.json` unless the task is explicitly about plugin updates.
