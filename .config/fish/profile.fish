set -gx TERM wezterm
set -gx PROJECT_PATHS ~/Projects
set -gx XDG_CONFIG_HOME "$HOME/.config"
set -gx ARCHPREFERENCE arm64
set -gx MANPAGER "sh -c 'col -bx | bat -l man -p'"
set -gx EDITOR nvim
set -gx NVIM_INIT "$HOME/.config/nvim/init.lua"
set -gx LS_COLORS "(vivid generate ~/.config/vivid/themes/zenwritten-dark.yml)"
set -x RIPGREP_CONFIG_PATH "$HOME/.ripgreprc"
set -gx PATH $HOME/.cargo/bin $PATH
set -U FZF_DEFAULT_COMMAND fd --threads 16
set -U SKIM_DEFAULT_COMMAND fd --type f --threads 16 || git ls-tree -r --name-only HEAD || rg --files || find .
# set -U FZF_CTRL_T_COMMAND "$FZF_DEFAULT_COMMAND"
# set -U FZF_OPEN_COMMAND "$FZF_DEFAULT_COMMAND"
set -U FZF_DEFAULT_OPTS "--ansi --type f --strip-cwd-prefix --follow --threads 16"
set -U FZF_FIND_FILE_COMMAND "$FZF_DEFAULT_COMMAND"
set -U FZF_PREVIEW_FILE_CMD "bat --paging=never --color=always --style=numbers --line-range :100"
set -U FZF_ENABLE_OPEN_PREVIEW 1
set -U FZF_PREVIEW_DIR_CMD lt
set -gx COREPACK_ENABLE_STRICT 0
set -U nvm_default_version 20

# Zenwritten dark as base for background/text
set -gx GUM_CHOOSE_HEADER_FOREGROUND 110 # blue (header)
set -gx GUM_CHOOSE_ITEM_FOREGROUND 244 # gray (default items)

# Git-specific semantic colors:
set -gx GUM_CHOOSE_SELECTED_FOREGROUND 2 # green (added)

set -gx GUM_CHOOSE_UNSELECTED_FOREGROUND 1 # red (unstaged)

# Cursor line (keep visually distinct; use purple or blue)
set -gx GUM_CHOOSE_CURSOR_FOREGROUND 140 # purple

# Optional: Use ✓ for selected and x for unselected
set -gx GUM_CHOOSE_SELECTED_PREFIX "󰄲 "
set -gx GUM_CHOOSE_UNSELECTED_PREFIX "󰄱 "
set -gx GUM_CHOOSE_CURSOR_PREFIX "󰡖 "

# disable backgrounds
set -gx GUM_CHOOSE_HEADER_BACKGROUND ""
set -gx GUM_CHOOSE_ITEM_BACKGROUND ""
set -gx GUM_CHOOSE_SELECTED_BACKGROUND ""
set -gx GUM_CHOOSE_UNSELECTED_BACKGROUND ""

# Don’t strip ANSI (keep color codes)
set -gx GUM_CHOOSE_STRIP_ANSI false
