# Neovim Configuration

Comprehensive Neovim config with Lazy.nvim plugin manager, modular Lua setup, and VSCode-mode support.

**Project:** [Neovim](https://neovim.io/) | Plugin Manager: [Lazy.nvim](https://github.com/folke/lazy.nvim)

**Entry point:**
- `init.lua` - Sets leader key, requires config module
- `lua/config/init.lua` - Main config that sources all modules

**Configuration modules (lua/config/):**
- `opts.lua` - Neovim options
- `abbr.lua` - Command abbreviations
- `autocmd.lua` - Autocommands and event handlers
- `lazy.lua` - Lazy.nvim bootstrap
- `colors.lua` - Color scheme and setup
- `usercmd.lua` - Custom user commands
- `vscode.lua` - VSCode mode configuration

**Keymaps (lua/config/keymaps/):**
- `core.lua` - Core navigation and editing
- `editing.lua` - Text editing operations
- `lsp.lua` - Language server protocol
- `navigation.lua` - Buffer/window navigation
- `plugins.lua` - Plugin-specific mappings
- `yank.lua` - Yank/clipboard operations

**Highlight groups (lua/config/hls/):**
- `float.lua` - Floating windows
- `git.lua` - Git-related highlights
- `indent.lua` - Indentation guides
- `leap.lua` - Leap plugin
- `match.lua` - Matching pairs
- `notify.lua` - Notifications
- `snacks.lua` - Snacks plugin
- `treesitter.lua` - Tree-sitter highlights

**Plugins (lua/plugins/):**

*AI:* OpenCode integration, code generation

*Core:* LSP, completion (nvim-cmp), formatting, editing, Tree-sitter

*Lang:* TypeScript, JSON, Markdown

*Misc:* Fun, help, profiling

*UI:* Buffers, colors, colorscheme, file explorer, highlights, notifications, splits, statusline, visuals, which-key, wildmenu

*Workflow:* Git, diagnostics, history, navigation, picker, productivity, session, terminal, testing

**Utilities (lua/utils/):**
- `fn.lua` - Function utilities
- `git.lua` - Git helpers
- `format.lua` - Formatting utilities
- `layout.lua` - Window layout
- `platform.lua` - Platform detection
- `project.lua` - Project utilities
- `refactor.lua` - Refactoring helpers
- `terminal.lua` - Terminal integration
- `yank.lua` - Yank/clipboard
- `agent.lua` - Agent helpers
- `kagi.lua` - Kagi search integration
- `vscode.lua` - VSCode integration
- `web.lua` - Web utilities

**Snippets:**
- `html.snippets`, `javascript.snippets`, `typescript.snippets`, `typescriptreact.snippets`

**Spell checking:**
- English and Danish spell dictionaries

**Notes:**
- Lazy.nvim bootstrapped in `lua/config/lazy.lua`
- VSCode mode disables UI plugins and loads minimal config
- Neovim state stored in `.undo`, `.backup`, `.sessions`, `.swp` directories (do not edit)
- Managed via Nix/Home Manager as part of dotfiles
- Includes agent documentation in `docs/agents/`
