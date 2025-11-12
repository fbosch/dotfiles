set -gx TERM wezterm
set -gx PROJECT_PATHS ~/Projects
set -gx XDG_CONFIG_HOME "$HOME/.config"
set -gx ZDOTDIR "$HOME/.config/zsh"
set -gx ARCHPREFERENCE arm64
set -gx MANPAGER "sh -c 'col -bx | bat -l man -p'"
set -gx EDITOR nvim
set -gx NVIM_INIT $HOME/.config/nvim/init.lua
set -gx OPENCODE_CONFIG_DIR $HOME/.config/opencode
set -gx LS_COLORS "(vivid generate ~/.config/vivid/themes/zenwritten-dark.yml)"
set -x RIPGREP_CONFIG_PATH "$HOME/.config/ripgrep/ripgreprc"
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
set -gx GPG_TTY (tty)
set -U nvm_default_version 20

# TODO: move this and make it consistent
set -gx GUM_CHOOSE_HEADER_FOREGROUND 110 # blue (header)
set -gx GUM_CHOOSE_ITEM_FOREGROUND 244 # gray (default items)
set -gx GUM_CHOOSE_SELECTED_FOREGROUND 2 # green (added)
set -gx GUM_CHOOSE_UNSELECTED_FOREGROUND 1 # red (unstaged)
set -gx GUM_CHOOSE_CURSOR_FOREGROUND 140 # purple
set -gx GUM_CHOOSE_SELECTED_PREFIX "󰄲 "
set -gx GUM_CHOOSE_UNSELECTED_PREFIX "󰄱 "
set -gx GUM_CHOOSE_CURSOR_PREFIX "󰡖 "
set -gx GUM_CHOOSE_HEADER_BACKGROUND ""
set -gx GUM_CHOOSE_ITEM_BACKGROUND ""
set -gx GUM_CHOOSE_SELECTED_BACKGROUND ""
set -gx GUM_CHOOSE_UNSELECTED_BACKGROUND ""
set -gx GUM_CHOOSE_STRIP_ANSI false
set -gx GUM_INPUT_CURSOR_FOREGROUND "#97bdde" # Accent blue (zenwritten)
set -gx GUM_INPUT_CURSOR_BACKGROUND "#191919" # Main background
set -gx GUM_INPUT_PROMPT_FOREGROUND "#97bdde" # Accent blue (zenwritten)
set -gx GUM_INPUT_PROMPT_BACKGROUND "#191919" # Background
set -gx GUM_INPUT_TEXT_FOREGROUND "#bbbbbb" # Light gray (zenwritten)
set -gx GUM_INPUT_PLACEHOLDER_FOREGROUND "#636363" # Placeholder: muted gray
set -gx GUM_INPUT_BORDER_FOREGROUND "#303030" # Border: medium/dark gray
set -gx GUM_INPUT_BACKGROUND "#191919" # Input background
