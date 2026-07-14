#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

readonly TERM_WAIT_SECONDS=1
readonly -a PRECLOSE_WINDOW_CLASSES=(
  "app.zen_browser.zen"
)

readonly -a PRETERM_PROCESS_ARGS=(
  "$HOME/.config/hypr/runtime/startup/startup-desktop-ready.sh"
  "$HOME/.config/hypr/runtime/desktop/waybar-edge-monitor.sh"
  "$HOME/.config/hypr/runtime/windows/daemons/window-state/window-state.sh"
  "$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.sh"
  "$HOME/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua"
  "$HOME/.config/waybar/scripts/mullvad-status"
)

preclose_windows() {
	local class address

  for class in "${PRECLOSE_WINDOW_CLASSES[@]}"; do
    while IFS= read -r address; do
      [[ -n "$address" ]] || continue

		hypr_dispatch_lua "hl.dsp.window.close({ window = \"address:$address\" })" || true
    done < <(
      hypr_query 'j/clients' \
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
