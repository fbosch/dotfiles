# Detect if running inside Cursor editor (more reliable detection)
set -g CURSOR_EDITOR false
# Check for Cursor editor using TERM_PROGRAM = vscode
if string match -q "vscode" $TERM_PROGRAM
    set -g CURSOR_EDITOR true
end

# Always initialize brew (needed for PATH and basic functionality)
switch (uname)
    case Linux
        if test -x /home/linuxbrew/.linuxbrew/bin/brew
            eval (/home/linuxbrew/.linuxbrew/bin/brew shellenv)
        end
    case Darwin
        if type -q brew
            eval (brew shellenv fish)
        end
end

# Always source core configuration files
for file in coreutils aliases scripts profile private colors
    if test -f ~/.config/fish/$file.fish
        source ~/.config/fish/$file.fish
    end
end

function fish_greeting
    # skip in neovim terminal buffer or Cursor editor
    if set -q IN_NEOVIM; or $CURSOR_EDITOR
        return
    end

    set day_of_week (date +%u)
    # skip if weekend
    if test $day_of_week -eq 6 -o $day_of_week -eq 7
        return
    end

    if test (uname) = Darwin
        first_login_of_the_day --silent &
    end
end

# --- sudo !! Replacement ---
function sudo --description "Run last command with sudo if '!!', otherwise normal sudo"
    if test (count $argv) -eq 1 -a "$argv" = "!!"
        eval command sudo $history[1]
    else
        command sudo $argv
    end
end

# --- lf directory switch ---
function lfcd --description "lf to switch directories"
    set -l tmp (mktemp)
    command lf -last-dir-path="$tmp" $argv
    if test -f "$tmp"
        set -l dir (cat "$tmp")
        rm -f "$tmp"
        if test -d "$dir" -a "$dir" != (pwd)
            cd "$dir"
            commandline --function repaint
        end
    end
end

# --- Keybindings ---
# Simplified keybindings for Cursor editor to reduce complexity
if $CURSOR_EDITOR
    # Minimal keybindings for Cursor editor
    bind \cP fzfcd
else
    # Full keybindings for regular terminals
    bind -M insert \cc kill-whole-line
    bind -M insert \cc repaint
    bind \cP fzfcd
end

function fish_user_keybindings
    # Use simpler keybinding mode in Cursor editor
    if $CURSOR_EDITOR
        fish_default_key_bindings
    else
        fish_vi_key_bindings
    end
end

# --- Third-party Tools ---
# Initialize tools with Cursor editor optimizations
if $CURSOR_EDITOR
    # Skip heavy tools in Cursor editor to prevent hanging
    # These tools can cause terminal hangs in editor environments
else
    # Full initialization for regular terminals
    if type -q zoxide
        zoxide init fish | source
    end
    if type -q starship
        starship init fish | source
    end
    if type -q fnm
        fnm env --use-on-cd --shell fish | source
    end
end

# --- pnpm ---
set -gx PNPM_HOME "$HOME/Library/pnpm"
if not string match -q -- $PNPM_HOME $PATH
    set -gx PATH $PNPM_HOME $PATH
end

# --- bun ---
set -gx BUN_INSTALL "$HOME/.bun"
set -gx PATH $BUN_INSTALL/bin $PATH

# --- Inshellisense ---
# Skip in Cursor editor as it has its own completion
if not $CURSOR_EDITOR; and test -f ~/.inshellisense/key-bindings.fish
    source ~/.inshellisense/key-bindings.fish
end

# --- Set universal keybinding mode ---
# Use simpler keybindings in Cursor editor for better performance
if $CURSOR_EDITOR
    set -U fish_key_bindings fish_default_key_bindings
else
    set -U fish_key_bindings fish_vi_key_bindings
end

# --- Cursor Editor Specific Optimizations ---
if $CURSOR_EDITOR
    # Disable fish greeting completely in Cursor editor
    set -g fish_greeting ""
    
    # Reduce history size for editor terminals
    set -g history_size 1000
    
    # Disable fish_private_mode for faster startup
    set -g fish_private_mode 0
    
    # Optimize PATH handling - avoid duplicate PATH entries
    set -g fish_user_paths $fish_user_paths
end
