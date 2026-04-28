#!/usr/bin/env bash

set -euo pipefail

declare -A LAYOUT_DISPLAY_CODES=(
  ["us"]="ENG"
  ["dk"]="DAN"
)

sync_gamescope_xwayland_layout() {
  local target_layout="$1"
  local setxkbmap_bin=""

  if setxkbmap_bin="$(command -v setxkbmap 2>/dev/null)"; then
    :
  elif [[ -x "/run/current-system/sw/bin/setxkbmap" ]]; then
    setxkbmap_bin="/run/current-system/sw/bin/setxkbmap"
  elif [[ -x "$HOME/.nix-profile/bin/setxkbmap" ]]; then
    setxkbmap_bin="$HOME/.nix-profile/bin/setxkbmap"
  elif [[ -x "/etc/profiles/per-user/$USER/bin/setxkbmap" ]]; then
    setxkbmap_bin="/etc/profiles/per-user/$USER/bin/setxkbmap"
  fi

  if [[ -z "$setxkbmap_bin" ]]; then
    echo "setxkbmap not found; skipping Gamescope Xwayland layout sync" >> /tmp/hyprland-layout.log
    return 0
  fi

  declare -A displays=()
  while IFS= read -r line; do
    while [[ "$line" =~ :([0-9]+) ]]; do
      displays[":${BASH_REMATCH[1]}"]=1
      line="${line#*:"${BASH_REMATCH[1]}"}"
    done
  done < <(pgrep -af 'Xwayland' || true)

  for display in "${!displays[@]}"; do
    DISPLAY="$display" "$setxkbmap_bin" -layout "$target_layout" -option '' >/dev/null 2>&1 || true
  done
}

keyboard_info="$(hyprctl devices -j | jq -rc '.keyboards[] | select(.main == true)')"
keyboard_name="$(jq -r '.name' <<< "$keyboard_info")"
current_layout="$(jq -r '.active_keymap' <<< "$keyboard_info")"

IFS=',' read -ra layouts <<< "$(jq -r '.layout' <<< "$keyboard_info")"

hyprctl switchxkblayout "$keyboard_name" next >/dev/null
sleep 0.1

keyboard_info="$(hyprctl devices -j | jq -rc '.keyboards[] | select(.main == true)')"
new_layout="$(jq -r '.active_keymap' <<< "$keyboard_info")"
new_index="$(jq -r '.active_layout_index' <<< "$keyboard_info")"
active_layout="${layouts[$new_index]}"
active_code="${LAYOUT_DISPLAY_CODES[$active_layout]:-$active_layout}"

layout_codes_array=()
for layout in "${layouts[@]}"; do
  layout_codes_array+=("${LAYOUT_DISPLAY_CODES[$layout]:-$layout}")
done

layouts_json="$(printf '%s\n' "${layout_codes_array[@]}" | jq -R . | jq -s .)"

sync_gamescope_xwayland_layout "$active_layout"

ags request -i ags-bundled keyboard-switcher "{\"action\":\"show\",\"config\":{\"layouts\":$layouts_json,\"activeLayout\":\"$active_code\",\"size\":\"sm\"}}"

echo "Keyboard layout switched from $current_layout to $new_layout (layout: $active_layout, code: $active_code)" >> /tmp/hyprland-layout.log
