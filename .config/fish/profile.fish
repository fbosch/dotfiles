set -gx TERM xterm-256color
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
# Lazy set GPG_TTY only when GPG is actually used (saves 5ms on startup)
if not set -q GPG_TTY
    set -gx GPG_TTY (tty 2>/dev/null || echo /dev/tty)
end
set -U nvm_default_version 20
