. ~/.config/fish/aliases.fish
. ~/.config/fish/profile.fish
. ~/.config/fish/colors.fish
. ~/.config/fish/nvm.fish

function fish_greeting
  if [ "$KITTY_WINDOW_ID" = "1" ]
    eval command 'curl "wttr.in/Copenhagen?format=\n+%c%C+%t++🌧️++%p++💧+%h++🌬️+%w\n"'
    eval command tl
  end
end

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
    set --local tmp "$(mktemp)"
    eval command lf -last-dir-path="$tmp" "$argv"

    if test -f "$tmp"
        set --local dir "$(cat "$tmp")"
        eval command rm -rf "$tmp" > /dev/null
        if test -d "$dir" && test "$dir" != "$(pwd)"
           cd "$dir"
           commandline --function repaint
        end
    end
end

bind -M insert \cc kill-whole-line repaint

# Keybindings
function fish_user_keybindings
  fish_vi_key_bindings
end


starship init fish | source
