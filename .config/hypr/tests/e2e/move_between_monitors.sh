#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/lib.sh"

title_prefix="${window_class}-move-between-$(date +%s)-$$"

status 'check runtime and select portrait workspace'
require_runtime
portrait_workspace_name="${HYPR_E2E_WORKSPACE:-$(pick_free_workspace || true)}"
[[ -n "$portrait_workspace_name" ]] || skip 'no free numeric workspace in 3..9 for portrait side of move e2e'
trap restore_session EXIT

status 'apply portrait workspace rule'
apply_workspace_rule "$portrait_workspace_name" "$portrait_monitor" 'lua:portrait_rows'
set_global_layout 'lua:portrait_rows'

status 'focus portrait workspace and create anchor windows'
focus_monitor_workspace "$portrait_monitor" "$portrait_workspace_name"
assert_focused_monitor_workspace "$portrait_monitor" "$portrait_workspace_name"

portrait_anchor_title="${title_prefix}-portrait-anchor"
moving_title="${title_prefix}-moving"
ultrawide_anchor_title="${title_prefix}-ultrawide-anchor"

spawn_window "$portrait_anchor_title" "$portrait_workspace_name"
wait_for_count 1
assert_identity "$portrait_anchor_title"
wait_for_workspace "$portrait_anchor_title" "$portrait_workspace_name"

spawn_window "$moving_title" "$portrait_workspace_name"
wait_for_count 2
assert_identity "$moving_title"
wait_for_workspace "$moving_title" "$portrait_workspace_name"
assert_below "$moving_title" "$portrait_anchor_title" 'initial moving portrait order'

status 'focus ultrawide workspace and create anchor window'
ultrawide_workspace_name="${HYPR_E2E_ULTRAWIDE_WORKSPACE:-$(pick_free_workspace || true)}"
[[ -n "$ultrawide_workspace_name" ]] || skip 'no free numeric workspace in 90..99 for ultrawide side of move e2e'
apply_workspace_rule "$ultrawide_workspace_name" "$ultrawide_monitor" 'lua:ultrawide_master'
set_global_layout 'lua:ultrawide_master'
focus_monitor_workspace "$ultrawide_monitor" "$ultrawide_workspace_name"

spawn_window "$ultrawide_anchor_title" "$ultrawide_workspace_name"
wait_for_count 3
assert_identity "$ultrawide_anchor_title"
wait_for_workspace "$ultrawide_anchor_title" "$ultrawide_workspace_name"

status 'move portrait window to ultrawide left edge'
focus_window_by_title "$moving_title"
custom_move right
wait_for_workspace "$moving_title" "$ultrawide_workspace_name"
assert_left_of "$moving_title" "$ultrawide_anchor_title" 'portrait to ultrawide transfer order'

status 'move ultrawide window back to portrait bottom'
focus_window_by_title "$moving_title"
custom_move down
wait_for_workspace "$moving_title" "$portrait_workspace_name"
assert_below "$moving_title" "$portrait_anchor_title" 'ultrawide to portrait transfer order'

status 'cleanup e2e windows'
cleanup_test_windows || fail 'test windows did not clean up'

printf 'PASS move_between_monitors e2e\n'
