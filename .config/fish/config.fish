if string match -q vscode $TERM_PROGRAM
    # Switch to dash in Cursor editor to avoid fish configuration issues
    set -x ENV "$HOME/.shinit"
    exec dash
end

function hyprstart
    exec uwsm start hyprland-uwsm.desktop
end

# Cache uname result as a universal variable (persists across sessions)
if not set -q OS_TYPE
    set -U OS_TYPE (uname)
end

switch $OS_TYPE
    case Linux
        if not test -f /etc/NIXOS
            if test -x /home/linuxbrew/.linuxbrew/bin/brew
                eval (/home/linuxbrew/.linuxbrew/bin/brew shellenv)
            end
        end
    case Darwin
        # Cache brew shellenv to avoid calling external command on every startup
        if not set -q HOMEBREW_PREFIX
            if test -x /opt/homebrew/bin/brew
                eval (/opt/homebrew/bin/brew shellenv fish)
            else if test -x /usr/local/bin/brew
                eval (/usr/local/bin/brew shellenv fish)
            end
        end
end

# Disabled coreutils to improve startup time (saves ~160ms)
# Use uutils commands explicitly (ucp, umv, etc.) if needed
# gum.fish is lazy-loaded via functions/gum.fish wrapper
for file in aliases scripts profile private colors
    if test -f ~/.config/fish/$file.fish
        source ~/.config/fish/$file.fish
    end
end

# All functions are now autoloaded from ~/.config/fish/functions/
# Old scripts archived to ~/.config/fish/scripts.old/

function fish_greeting
    # skip in neovim terminal buffer
    if set -q IN_NEOVIM
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
bind -M insert \cc kill-whole-line
bind -M insert \cc repaint
bind \cP fzfcd

function fish_user_keybindings
    fish_vi_key_bindings
end

# --- Third-party Tools ---
# Zoxide initialization (cached for performance)
if test -f ~/.config/fish/conf.d/zoxide_cache.fish
    # Cache exists, already auto-sourced from conf.d/
else if command -v zoxide >/dev/null 2>&1
    # No cache, initialize directly (regenerate cache with: zoxide init fish > ~/.config/fish/conf.d/zoxide_cache.fish)
    zoxide init fish | source
end

# --- Starship Configuration ---
# Use TTY-safe config for console (TTY1), unicode config for terminal emulators
if test $OS_TYPE = Linux
    # Check if we're in TTY1 (console) vs terminal emulator
    # TTY1 typically doesn't have DISPLAY/WAYLAND_DISPLAY and tty shows /dev/tty1
    set -l tty_device (tty 2>/dev/null)
    if test -z "$DISPLAY" -a -z "$WAYLAND_DISPLAY" -a -n "$tty_device" -a (string match -q "/dev/tty*" "$tty_device")
        set -gx STARSHIP_CONFIG "$HOME/.config/starship-tty.toml"
    else
        set -gx STARSHIP_CONFIG "$HOME/.config/starship.toml"
    end
else
    # On macOS, assume terminal emulator (always use unicode config)
    set -gx STARSHIP_CONFIG "$HOME/.config/starship.toml"
end

# Starship initialization (cached for performance)
if test -f ~/.config/fish/conf.d/starship_cache.fish
    # Cache exists, already auto-sourced from conf.d/
else if command -v starship >/dev/null 2>&1
    # No cache, initialize directly (regenerate cache with: starship init fish --print-full-init > ~/.config/fish/conf.d/starship_cache.fish)
    starship init fish | source
end

# fnm (Fast Node Manager)
# Load eagerly - lazy loading causes issues with git hooks, mprocs, etc.
fnm env --use-on-cd --log-level=quiet --shell fish | source

# --- pnpm ---
set -gx PNPM_HOME "$HOME/Library/pnpm"
if not string match -q -- $PNPM_HOME $PATH
    set -gx PATH $PNPM_HOME $PATH
end

# --- bun ---
set -gx BUN_INSTALL "$HOME/.bun"
set -gx PATH $BUN_INSTALL/bin $PATH

# --- Inshellisense ---
if test -f ~/.inshellisense/key-bindings.fish
    source ~/.inshellisense/key-bindings.fish
end

fish_add_path $HOME/.local/bin
