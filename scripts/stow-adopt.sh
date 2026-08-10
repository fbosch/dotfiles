#!/usr/bin/env bash
set -euo pipefail

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  printf '%s\n' "stow-adopt: run this command from the dotfiles Git repository" >&2
  exit 1
fi

cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' "stow-adopt: Git working tree must be clean before adopting files" >&2
  exit 1
fi

printf '%s\n' "Dotfiles adoption migration: previewing changes before modifying the repository..."
stow --adopt --restow --verbose --no -t "$HOME" .

if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' "stow-adopt: dry-run unexpectedly modified the Git working tree; refusing to continue" >&2
  exit 1
fi

printf '%s\n' "Dotfiles adoption migration: moving managed target files into the repository. Normal deployment never uses --adopt."
stow --adopt --restow --verbose -t "$HOME" .
