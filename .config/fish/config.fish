if string match -q vscode $TERM_PROGRAM
    # Switch to dash in Cursor editor to avoid fish configuration issues
    set -x ENV "$HOME/.shinit"
    exec dash
end

function hyprstart
    # Launch Hyprland with UWSM for proper systemd integration and watchdog notifications
    # The -F flag (finalize) enables watchdog support, preventing TXT_KEY_NOTIF_NO_WATCHDOG warnings
    exec uwsm start -F hyprland.desktop
end

# Keep OS detection per-shell. Universal variables are shared across hosts and can
# leave Linux shells using a stale Darwin value after syncing dotfiles.
set -g OS_TYPE (uname)

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

for file in profile private
    if test -f ~/.config/fish/$file.fish
        source ~/.config/fish/$file.fish
    end
end

set -e OPENAI_API_KEY

if status is-interactive
    for file in aliases scripts colors fzf
        if test -f ~/.config/fish/$file.fish
            source ~/.config/fish/$file.fish
        end
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
        # Run in completely detached process to avoid any shell startup delay
        fish -c "first_login_of_the_day --silent" &
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
if status is-interactive
    bind -M insert \cc kill-whole-line
    bind -M insert \cc repaint
    bind \cP ctrl_p_picker
end

function fish_user_keybindings
    fish_vi_key_bindings
    bind \cg _navi_smart_replace
    bind --mode insert \cg _navi_smart_replace
    bind --mode insert \cP ctrl_p_picker
end

# --- Third-party Tools ---
# Atuin shell history
if status is-interactive
    function __load_atuin
        set -q __ATUIN_LOADED; and return 0
        command -q atuin; or return 1

        set -l atuin_cache ~/.cache/fish/atuin-init.fish
        if not test -f $atuin_cache
            mkdir -p (dirname $atuin_cache)
            atuin init fish --disable-up-arrow > $atuin_cache
        end
        source $atuin_cache
        set -g __ATUIN_LOADED 1
    end

    function _atuin_search
        functions -e _atuin_search
        __load_atuin; and _atuin_search $argv
    end

    function __atuin_lazy_preexec --on-event fish_preexec
        functions -e __atuin_lazy_preexec
        __load_atuin; and _atuin_preexec $argv
    end

    bind ctrl-r _atuin_search
    bind --mode insert ctrl-r _atuin_search
end

# Zoxide initialization
if status is-interactive
    set -l zoxide_cache ~/.cache/fish/zoxide-init.fish
    if not test -f $zoxide_cache
        if command -v zoxide >/dev/null 2>&1
            mkdir -p (dirname $zoxide_cache)
            zoxide init fish > $zoxide_cache
        end
    end
    if test -f $zoxide_cache
        source $zoxide_cache
    end
end

# Navi widget (Ctrl+G)
if status is-interactive
    set -l navi_cache ~/.cache/fish/navi-widget.fish
    if not test -f $navi_cache
        if command -v navi >/dev/null 2>&1
            mkdir -p (dirname $navi_cache)
            navi widget fish > $navi_cache
        end
    end
    if test -f $navi_cache
        source $navi_cache
    end
end

if status is-interactive
    set -l just_cache ~/.cache/fish/generated_completions/just.fish
    if not test -f $just_cache
        if command -v just >/dev/null 2>&1
            mkdir -p (dirname $just_cache)
            just --completions fish > $just_cache
        end
    end
end

# --- Starship Configuration ---
# Use TTY-safe config for console (TTY1), unicode config for terminal emulators
if test $OS_TYPE = Linux
    # Check if we're in TTY1 (console) vs terminal emulator
    # TTY1 typically doesn't have DISPLAY/WAYLAND_DISPLAY and tty shows /dev/tty1
    # Exclude SSH sessions (SSH_TTY or SSH_CONNECTION will be set)
    if test -z "$SSH_TTY" -a -z "$SSH_CONNECTION" -a -z "$DISPLAY" -a -z "$WAYLAND_DISPLAY"
        set -l tty_device (tty 2>/dev/null)
        if test -n "$tty_device" -a (string match -q "/dev/tty*" "$tty_device")
            set -gx STARSHIP_CONFIG "$HOME/.config/starship-tty.toml"
        else
            set -gx STARSHIP_CONFIG "$HOME/.config/starship.toml"
        end
    else
        set -gx STARSHIP_CONFIG "$HOME/.config/starship.toml"
    end
else
    # On macOS, assume terminal emulator (always use unicode config)
    set -gx STARSHIP_CONFIG "$HOME/.config/starship.toml"
end

# Starship initialization
if status is-interactive
    set -l starship_cache ~/.cache/fish/starship-init.fish
    if not test -f $starship_cache
        if command -v starship >/dev/null 2>&1
            mkdir -p (dirname $starship_cache)
            starship init fish --print-full-init > $starship_cache
        end
    end
    if test -f $starship_cache
        source $starship_cache
    end
end

# fnm (Fast Node Manager)
function __load_fnm
    set -q FNM_MULTISHELL_PATH; and return 0
    command -q fnm; or return 1

    command fnm env --use-on-cd --version-file-strategy=recursive --log-level=quiet --shell fish | source
    functions -e fnm node npm npx pnpm pnpx yarn corepack
end

function fnm
    __load_fnm; and command fnm $argv
end

function node
    __load_fnm; and command node $argv
end

function npm
    __load_fnm; and command npm $argv
end

function npx
    __load_fnm; and command npx $argv
end

function pnpm
    __load_fnm; and command pnpm $argv
end

function pnpx
    __load_fnm; and command pnpx $argv
end

function yarn
    __load_fnm; and command yarn $argv
end

function corepack
    __load_fnm; and command corepack $argv
end

# --- pnpm globals (managed by Nix) ---
switch $OS_TYPE
    case Darwin
        set -gx PNPM_HOME "$HOME/Library/pnpm"
    case '*'
        set -gx PNPM_HOME "$HOME/.local/share/pnpm"
end
fish_add_path --path --prepend "$PNPM_HOME/bin"

# --- bun ---
set -gx BUN_INSTALL "$HOME/.bun"

fish_add_path --path --prepend $BUN_INSTALL/bin

# --- Nix paths (ensure they come before package-manager globals) ---
if test -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.fish
    source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.fish
end

for nix_path in /nix/var/nix/profiles/default/bin $HOME/.nix-profile/bin /etc/profiles/per-user/$USER/bin /run/current-system/sw/bin /run/wrappers/bin
    if test -d $nix_path
        fish_add_path --path --prepend --move $nix_path
    end
end

# --- Homebrew paths (ensure they're present for child processes like Neovim) ---
if test $OS_TYPE = Darwin
    fish_add_path --path /opt/homebrew/bin /opt/homebrew/sbin
end

# --- Inshellisense ---
if status is-interactive; and test -f ~/.inshellisense/key-bindings.fish
    source ~/.inshellisense/key-bindings.fish
end

fish_add_path --path --append $HOME/.local/bin

# Keep fnm's selected Node ahead of Nix/Homebrew Node entries after PATH setup.
if set -q FNM_MULTISHELL_PATH; and test "$PATH[1]" != "$FNM_MULTISHELL_PATH/bin"
    set -gx PATH "$FNM_MULTISHELL_PATH/bin" $PATH
end
