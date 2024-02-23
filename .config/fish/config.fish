. ~/.config/fish/scripts.fish
. ~/.config/fish/aliases.fish
. ~/.config/fish/profile.fish
. ~/.config/fish/private.fish
. ~/.config/fish/colors.fish

if test (uname) = "Linux"
  eval (/home/linuxbrew/.linuxbrew/bin/brew shellenv)
end


function update_work_hours --on-event __zoxide_hook
  fish -c 'fish ~/.config/fish/work_hours.fish &; disown;'; 
  commandline --function repaint;
end;

function fish_greeting
  update_work_hours &;
end;

# Custom Function for a sudo !! replacement
function sudo --description "replacement for 'sudo !!' command to run last command using sudo"
    if test "$argv" = !!
    eval command sudo $history[1]
else
    command sudo $argv
    end
end

# Switch directories using LF
function lfcd --description "lf to switch directories"
    set --local tmp "(mktemp)"
    eval command lf -last-dir-path="$tmp" "$argv"

    if test -f "$tmp"
        set --local dir "(cat "$tmp")"
        eval command rm -rf "$tmp" > /dev/null
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
set -gx PNPM_HOME "/Users/fbb/Library/pnpm"
if not string match -q -- $PNPM_HOME $PATH
  set -gx PATH "$PNPM_HOME" $PATH
end
# pnpm end

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH
set -U fish_key_bindings fish_default_key_bindings
bind \cP 'fzfcd'

# Keybindings
function fish_user_keybindings
  fish_vi_key_bindings
end

[ -f ~/.inshellisense/key-bindings.fish ] && source ~/.inshellisense/key-bindings.fish

