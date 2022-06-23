. ~/.config/fish/aliases.fish
. ~/.config/fish/profile.fish

set fish_greeting

# Custom Function for a sudo !! replacement
function sudo --description "replacement for 'sudo !!' command to run last command using sudo"
    if test "$argv" = !!
    eval command sudo $history[1]
else
    command sudo $argv
    end
end

# Keybindings
function fish_user_keybindings
  fish_vi_key_bindings
end

