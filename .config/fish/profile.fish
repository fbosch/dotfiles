set -gx PROJECT_PATHS ~/Projects
set -gx nvm_default_version "17"
set -gx ARCHPREFERENCE "arm64"
set -gx EDITOR "nvim"
set -gx FZF_DEFAULT_COMMAND "fd --type file --color=always --threads=16"
set -gx FZF_CTRL_T_COMMAND "$FZF_DEFAULT_COMMAND"
set -gx FZF_DEFAULT_OPTS "--ansi"
set -U FZF_FIND_FILE_COMMAND "$FZF_DEFAULT_COMMAND"
set -U FZF_PREVIEW_FILE_CMD	"bat --paging=never --color=always --style=numbers --line-range :100"
set -U FZF_ENABLE_OPEN_PREVIEW 1
set -U FZF_PREVIEW_DIR_CMD "lt"
