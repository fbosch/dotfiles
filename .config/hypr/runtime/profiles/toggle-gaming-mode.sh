#!/usr/bin/env dash

set -eu

PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/toggle-gaming-mode.lock"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

if "$PROFILECTL" is-source-active gaming manual; then
  "$PROFILECTL" remove-source gaming manual

  ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "󰺵" 64 "#dea721" 2>/dev/null || echo "")
  if [ -n "$ICON" ] && [ -f "$ICON" ]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:game-mode "Game Mode Disabled" -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:game-mode "Game Mode Disabled"
  fi

  exit 0
fi

"$PROFILECTL" apply-source gaming manual

ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "󰺵" 64 "#73bc6f" 2>/dev/null || echo "")
if [ -n "$ICON" ] && [ -f "$ICON" ]; then
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:game-mode "Game Mode Enabled" -i "$ICON"
else
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:game-mode "Game Mode Enabled"
fi
