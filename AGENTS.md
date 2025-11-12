# Dotfiles Repository - Agent Guide

## ⚠️ DO NOT EDIT - Auto-Generated Files

- `lazy-lock.json` - Neovim plugin lockfile (managed by Lazy.nvim)
- `Brewfile.lock.json` - Homebrew bundle lockfile
- `.config/nvim/.sessions/`, `.config/nvim/.undo/`, `.config/nvim/.backup/` - Neovim state
- `.config/fish/{fish_variables,completions,conf.d,functions}/` - Fish shell state (managed by fisher)
- `.config/lazygit/state.yml` - Lazygit state
- **Focus on source configs only!**

## 📦 Repository Overview

Personal dotfiles managed with GNU Stow for symlink management. Primary configs:

- **Neovim:** 128+ Lua files, Lazy.nvim plugin manager, LSP, Treesitter, custom utils
- **Shell:** Fish (primary), dash (Cursor/VSCode fallback)
- **Terminal:** WezTerm
- **Display:** Hyprland (Linux)
- **Theme:** Zenwritten Dark (consistent across nvim, wezterm, bat, opencode, etc.)

## 🔧 Common Operations

### Setup & Installation

```bash
brew bundle install              # Install/update all dependencies
stow .                            # Apply dotfiles (creates symlinks from ~/)
stow -n .                         # Dry-run to preview changes
bash ./scripts/install.sh         # Fresh system setup (installs everything)
```

### Neovim

```bash
nvim --headless +"Lazy! sync" +qa    # Update plugins
nvim --headless +checkhealth +qa     # Validate setup
```

### Testing Changes

```bash
fish -c "source ~/.config/fish/config.fish"  # Test fish config
bat cache --build                            # Rebuild bat cache after theme changes
stow -n .                                    # Preview stow changes before applying
```

## 📝 Lua Style (Neovim Configs)

### Module Pattern

```lua
local M = {}

-- Private function (local)
local function helper_function()
  -- implementation
end

-- Public function
function M.public_function()
  -- implementation
end

return M
```

### Conventions

- **Imports:** Group at top: `local git = require("utils.git")`
- **Functions:** `snake_case` - `function M.word_wrap()`, `local function get_terminal_width()`
- **Indentation:** 2 spaces, `expandtab`, `smartindent`
- **Error handling:** Guard clauses, nil checks: `if handle == nil then return nil end`
- **Keymaps:** Use `require("utils").set_keymap()` NOT `vim.keymap.set()` directly
  - Signature: `set_keymap(mode, lhs, rhs, opts_or_desc)`
  - Provides defaults: `noremap = true, silent = true`
- **User commands:** Use `require("utils").set_usrcmd()` NOT `vim.api.nvim_create_user_command()`

### Plugin Structure (Lazy.nvim)

- Files in `.config/nvim/lua/plugins/{category}/` return table(s) with plugin specs
- Categories: `ai/`, `core/`, `lang/`, `misc/`, `ui/`, `workflow/`
- Example spec:

```lua
return {
  {
    "author/plugin-name",
    dependencies = { "other/plugin" },
    event = "VeryLazy",  -- or cmd, keys, ft, etc.
    config = function()
      require("plugin-name").setup({ ... })
    end,
  },
}
```

## 🐟 Fish Shell Style

- **Abbreviations:** Prefer `abbr` over `alias` for shell expansion (e.g., `abbr n nvim`)
- **Functions:** Use for complex logic, `snake_case` naming
- **Conditionals:** `switch/case` for platform detection

## 📂 File Organization

```
.config/{app}/              # App-specific configs
.config/nvim/
  lua/
    config/                 # Core nvim config (opts, keymaps, autocmd, etc.)
      keymaps/{category}/   # Organized keybindings
      hls/                  # Highlight groups
    plugins/{category}/     # Lazy.nvim plugin specs by category
    utils/                  # Reusable utility modules (git, format, fn, etc.)
  snippets/                 # Snippet files
  spell/                    # Custom spellcheck dictionaries
.config/fish/
  config.fish              # Main config (sources other files)
  aliases.fish             # Aliases and abbreviations
  profile.fish             # Environment variables
  scripts.fish             # Helper functions
scripts/                    # Repo maintenance scripts (ignored by stow)
Brewfile                    # All Homebrew dependencies
```

## 🎨 Theme & Consistency

- **Colorscheme:** Zenwritten Dark everywhere
- **Fonts:** Zenbones Brainy, JetBrains Mono, BabelStone Runic, Symbols Nerd Font
- When modifying themes: Update `.config/{nvim,wezterm,bat,opencode,rofi,waybar,etc.}`

## 🖥️ Platform-Specific Notes

- Check platform: `require("utils.platform")` in Lua, `switch (uname)` in Fish
- **macOS (Darwin):** Uses Homebrew from `/opt/homebrew` or `/usr/local`
- **Linux:** May use Homebrew from `/home/linuxbrew/.linuxbrew` or native package managers
- **Cursor/VSCode:** Fish auto-switches to dash (see `.config/fish/config.fish:1-4`)

## 🧪 Validation Checklist

Before committing config changes:

1. [ ] Run `stow -n .` to preview symlink changes
2. [ ] Test Neovim: `nvim --headless +checkhealth +qa`
3. [ ] Test Fish: `fish -c "source ~/.config/fish/config.fish"`
4. [ ] Verify no auto-generated files are staged: `git status`
5. [ ] Check `.gitignore` patterns match
