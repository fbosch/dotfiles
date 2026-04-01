#!/usr/bin/env bash

hypr_popup_find_existing_window() {
  local class_name="$1"

  if command -v hyprctl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    hyprctl clients -j 2>/dev/null | jq -r --arg class "$class_name" 'first(.[] | select(.class == $class) | "\(.address)|\(.workspace.name)") // empty'
    return
  fi

  printf '%s' ""
}

hypr_workspace_under_cursor() {
  local cursor_x cursor_y cursor_pos

  cursor_pos="$(hyprctl cursorpos 2>/dev/null | tr -d ' ')"
  if [[ -z "$cursor_pos" ]]; then
    hyprctl activeworkspace -j 2>/dev/null | jq -r '.name // empty'
    return
  fi

  IFS=',' read -r cursor_x cursor_y <<< "$cursor_pos"
  if [[ -z "$cursor_x" || -z "$cursor_y" ]]; then
    hyprctl activeworkspace -j 2>/dev/null | jq -r '.name // empty'
    return
  fi

  hyprctl monitors -j 2>/dev/null | jq -r --arg x "$cursor_x" --arg y "$cursor_y" '
    ($x | tonumber) as $cx
    | ($y | tonumber) as $cy
    | first(
        .[]
        | select($cx >= .x and $cx < (.x + .width) and $cy >= .y and $cy < (.y + .height))
        | .activeWorkspace.name
      ) // empty
  '
}

hypr_popup_toggle_or_focus_existing_window() {
  local class_name="$1"
  local special_workspace="$2"
  local existing_window address workspace_name active_address target_workspace

  existing_window="$(hypr_popup_find_existing_window "$class_name")"
  if [[ -z "$existing_window" ]]; then
    return 1
  fi

  IFS='|' read -r address workspace_name <<< "$existing_window"
  active_address="$(hyprctl activewindow -j 2>/dev/null | jq -r '.address // empty')"

  if [[ "$active_address" == "$address" ]]; then
    hyprctl dispatch movetoworkspacesilent "special:${special_workspace},address:${address}" >/dev/null 2>&1 || true
    return 0
  fi

  if [[ "$workspace_name" == special:* ]]; then
    target_workspace="$(hypr_workspace_under_cursor)"
    if [[ -n "$target_workspace" ]]; then
      hyprctl dispatch movetoworkspacesilent "${target_workspace},address:${address}" >/dev/null 2>&1 || true
    fi
  fi

  hyprctl dispatch focuswindow "address:${address}" >/dev/null 2>&1 || true
  return 0
}

hypr_popup_wait_for_window() {
  local class_name="$1"
  local existing_window=""

  for _ in {1..20}; do
    existing_window="$(hypr_popup_find_existing_window "$class_name")"
    if [[ -n "$existing_window" ]]; then
      printf '%s' "$existing_window"
      return
    fi

    sleep 0.05
  done

  printf '%s' ""
}
