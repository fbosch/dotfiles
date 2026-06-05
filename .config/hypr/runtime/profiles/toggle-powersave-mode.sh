#!/usr/bin/env dash

set -eu

PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/hypr-profiles/toggle-powersave-mode.lock"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

if "$PROFILECTL" is-active powersave; then
  "$PROFILECTL" remove powersave

  ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "󰠠" 64 "#dea721" 2>/dev/null || echo "")
  if [ -n "$ICON" ] && [ -f "$ICON" ]; then
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:powersave-mode "Powersave Mode Disabled" -i "$ICON"
  else
    notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:powersave-mode "Powersave Mode Disabled"
  fi

  exit 0
fi

"$PROFILECTL" apply powersave

ICON=$(~/.config/hypr/runtime/desktop/nerd-icon-gen.sh "󱤅" 64 "#73bc6f" 2>/dev/null || echo "")
if [ -n "$ICON" ] && [ -f "$ICON" ]; then
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:powersave-mode "Powersave Mode Enabled" -i "$ICON"
else
  notify-send -a "Hyprland" -h string:x-canonical-private-synchronous:powersave-mode "Powersave Mode Enabled"
fi
