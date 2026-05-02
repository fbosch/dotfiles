#!/usr/bin/env bash
set -euo pipefail

readonly TERM_WAIT_SECONDS=1
readonly -a PRECLOSE_WINDOW_CLASSES=(
  "app.zen_browser.zen"
)

readonly -a PRETERM_PROCESS_ARGS=(
  "$HOME/.config/hypr/runtime/startup/startup-desktop-ready.sh"
  "$HOME/.config/hypr/runtime/desktop/waybar-edge-monitor.sh"
  "$HOME/.config/hypr/runtime/windows/window-state.sh"
  "$HOME/.config/hypr/runtime/windows/window-capture-daemon.sh"
  "$HOME/.config/waybar/scripts/mullvad-status"
)

preclose_windows() {
  local provider class address
  provider=$(hyprctl status -j | jq -r '.configProvider // ""' 2>/dev/null || true)

  for class in "${PRECLOSE_WINDOW_CLASSES[@]}"; do
    while IFS= read -r address; do
      [[ -n "$address" ]] || continue

      if [[ $provider == lua ]]; then
        hyprctl dispatch "hl.dsp.window.close({ window = \"address:$address\" })" >/dev/null 2>&1 || true
      else
        hyprctl dispatch closewindow "address:$address" >/dev/null 2>&1 || true
      fi
    done < <(
      hyprctl clients -j \
        | jq -r --arg class "$class" '.[] | select(.class == $class and .address != null) | .address' \
        || true
    )
  done
}

preterm_processes() {
  local arg pid pid_dir self cmdline
  self=$$

  for pid_dir in /proc/[0-9]*; do
    pid=${pid_dir##*/}
    [[ "$pid" != "$self" && -r "$pid_dir/cmdline" ]] || continue

    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null || true)
    [[ -n "$cmdline" ]] || continue

    for arg in "${PRETERM_PROCESS_ARGS[@]}"; do
      if [[ " $cmdline " == *" $arg "* ]]; then
        kill -TERM "$pid" >/dev/null 2>&1 || true
        break
      fi
    done
  done
}

preclose_windows
preterm_processes

sleep "$TERM_WAIT_SECONDS"

exec hyprshutdown "$@"
