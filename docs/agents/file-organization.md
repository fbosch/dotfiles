# File Organization

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
.config/vicinae/extensions/ # Custom Vicinae extensions (see AGENTS.md in this dir)
scripts/                    # Repo maintenance scripts (ignored by stow)
Brewfile                    # All Homebrew dependencies
```
