. ~/.config/fish/coreutils.fish
. ~/.config/fish/aliases.fish
. ~/.config/fish/scripts.fish
. ~/.config/fish/profile.fish
. ~/.config/fish/private.fish
. ~/.config/fish/colors.fish

if test (uname) = Linux
    eval (/home/linuxbrew/.linuxbrew/bin/brew shellenv)
end

function fish_greeting
    # skip in neovim terminal buffer
    if set -q IN_NEOVIM
        return
    end

    # skip if weekend
    set day_of_week (date +%u)
    if test $day_of_week -eq 6 -o $day_of_week -eq 7
        return
    end

    if test (uname) = Darwin
        first_login_of_the_day --silent &
    end
end

# Custom Function for a sudo (!!) replacement
function sudo --description "replacement for 'sudo !!' command to run last command using sudo"
    if test "$argv" = !!
        eval command sudo $history[1]
    else
        command sudo $argv
    end
end

# Switch directories using lf
function lfcd --description "lf to switch directories"
    set --local tmp "(mktemp)"
    eval command lf -last-dir-path="$tmp" "$argv"

    if test -f "$tmp"
        set --local dir "(cat "$tmp")"
        eval command rm -rf "$tmp" >/dev/null
        if test -d "$dir" && test "$dir" != "(pwd)"
            cd "$dir"
            commandline --function repaint
        end
    end
end

bind -M insert \cc kill-whole-line repaint

zoxide init fish | source
starship init fish | source

# pnpm
set -gx PNPM_HOME /Users/fbb/Library/pnpm
if not string match -q -- $PNPM_HOME $PATH
    set -gx PATH "$PNPM_HOME" $PATH
end
# pnpm end

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH
set -U fish_key_bindings fish_default_key_bindings

# bind ctrl-p to fzf utility to change directories
bind \cP fzfcd

# Keybindings
function fish_user_keybindings
    fish_vi_key_bindings
end

[ -f ~/.inshellisense/key-bindings.fish ] && source ~/.inshellisense/key-bindings.fish
