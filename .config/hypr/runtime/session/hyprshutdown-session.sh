#!/usr/bin/env bash
set -euo pipefail

readonly TERM_WAIT_SECONDS=1
readonly -a PRECLOSE_WINDOW_CLASSES=(
  "app.zen_browser.zen"
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

preclose_windows

sleep "$TERM_WAIT_SECONDS"

exec hyprshutdown "$@"
