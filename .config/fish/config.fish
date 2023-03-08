. ~/.config/fish/aliases.fish
. ~/.config/fish/profile.fish
. ~/.config/fish/colors.fish
. ~/.config/fish/nvm.fish

function fish_greeting
  if [ "$KITTY_WINDOW_ID" = "1" ]
    eval command prettier_d_slim start > /dev/null
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

function set_nvm --on-event fish_prompt
    # runs whenever the fish_prompt event occurs
    # if the current directory hasn't changed, do nothing
    string match -q $PWD $PREV_PWD; and return 1

    # if the current directory is within the previous one where we found an nvmrc
    # and there is no subsequent .nvmrc here, do nothing, we are in the same repo
    string match -eq $PREV_PWD $PWD; and not test -e '.nvmrc'; and return 1

    # if we clear those checks, keep track of where we are
    set -g PREV_PWD $PWD

    if test -e '.nvmrc'

        # if we find .nvmrc, run nvm use
        nvm use --silent

        # and remember that we used that node
        set NVM_DIRTY true

    else if not string match $NVM_DIRTY true

        # if we have set nvm and have stepped out of that repo
        # go back to default node, if not already on it
        not string match -eq (nvm current); and nvm use default --silent

        # and clear the flag
        set NVM_DIRTY
    end
end

zoxide init fish | source
starship init fish | source

# pnpm
set -gx PNPM_HOME "/Users/fbb/Library/pnpm"
set -gx PATH "$PNPM_HOME" $PATH
# pnpm end
