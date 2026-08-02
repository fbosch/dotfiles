#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/../lib/hypr-ipc.sh"

vrr="$(hyprctl getoption misc:vrr -j | jq -r '.int')"
direct_scanout="$(hyprctl getoption render:direct_scanout -j | jq -r '.int')"

printf 'VRR policy: %s\n' "$vrr"
printf 'Direct scanout policy: %s\n' "$direct_scanout"
printf 'Monitors:\n'
hypr_query j/monitors | jq -r '.[] | "  \(.name): \(.currentFormat), VRR=\(.vrr), direct scanout=\(.directScanoutTo)"'
printf 'Game clients:\n'
hypr_query j/clients | jq -r '
  [.[] | select(.contentType == "game")]
  | if length == 0 then "  none"
    else .[] | "  \(.class): \(.title) on \(.workspace.name)"
    end
'
