typeset -U path PATH

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

path=(
  "$HOME/.local/bin"
  "$HOME/.cargo/bin"
  "$HOME/.npm-packages/bin"
  "$HOME/Library/pnpm"
  "$HOME/.bun/bin"
  $path
)

export PNPM_HOME="$HOME/Library/pnpm"
export BUN_INSTALL="$HOME/.bun"

if [[ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]]; then
  . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  path=(
    "/run/current-system/sw/bin"
    "/etc/profiles/per-user/fbb/bin"
    "$HOME/.nix-profile/bin"
    "/nix/var/nix/profiles/default/bin"
    $path
  )
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell zsh)"
fi

export PATH
