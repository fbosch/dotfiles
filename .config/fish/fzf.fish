# FZF Performance Optimizations
# https://github.com/junegunn/fzf

# Default options for better performance and UX
set -gx FZF_DEFAULT_OPTS "\
--height=100% \
--layout=reverse \
--info=inline \
--border=none \
--cycle \
--bind=ctrl-u:half-page-up,ctrl-d:half-page-down \
--color=dark \
--color=fg:-1,bg:-1,hl:#5fff87,fg+:-1,bg+:-1,hl+:#ffaf5f \
--color=info:#af87ff,prompt:#5fff87,pointer:#ff87d7,marker:#ff87d7,spinner:#ff87d7"

# Use fd for file finding (faster than find, respects .gitignore)
if command -v fd >/dev/null 2>&1
    set -gx FZF_DEFAULT_COMMAND "fd --type f --hidden --follow --exclude .git"
    set -gx FZF_CTRL_T_COMMAND "$FZF_DEFAULT_COMMAND"
    set -gx FZF_ALT_C_COMMAND "fd --type d --hidden --follow --exclude .git"
else if command -v rg >/dev/null 2>&1
    # Fallback to ripgrep if fd is not available
    set -gx FZF_DEFAULT_COMMAND "rg --files --hidden --follow --glob '!.git'"
    set -gx FZF_CTRL_T_COMMAND "$FZF_DEFAULT_COMMAND"
end

# Preview options
if command -v bat >/dev/null 2>&1
    set -gx FZF_CTRL_T_OPTS "--preview 'bat --style=numbers --color=always --line-range :500 {}'"
end
