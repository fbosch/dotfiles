#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/lib.sh"

title_prefix="${window_class}-portrait-$(date +%s)-$$"

status 'check runtime and select portrait workspace'
require_runtime
workspace_name="${HYPR_E2E_WORKSPACE:-$(pick_free_workspace || true)}"
[[ -n "$workspace_name" ]] || skip 'no free numeric workspace in 3..9 for portrait e2e'
trap restore_session EXIT

status 'apply portrait workspace rule'
apply_workspace_rule "$workspace_name" "$portrait_monitor" 'lua:portrait_rows'
set_global_layout 'lua:portrait_rows'

status 'focus portrait test workspace'
focus_monitor_workspace "$portrait_monitor" "$workspace_name"
assert_focused_monitor_workspace "$portrait_monitor" "$workspace_name"

first_title="${title_prefix}-first"
second_title="${title_prefix}-second"
reopened_title="${title_prefix}-reopened"

status 'spawn first portrait window'
spawn_window "$first_title" "$workspace_name"
wait_for_count 1
assert_identity "$first_title"
wait_for_workspace "$first_title" "$workspace_name"

status 'spawn second portrait window at bottom'
spawn_window "$second_title" "$workspace_name"
wait_for_count 2
assert_identity "$second_title"
wait_for_workspace "$second_title" "$workspace_name"
assert_below "$second_title" "$first_title" 'initial portrait spawn order'

status 'move second portrait window upward'
focus_window_by_title "$second_title"
layout_msg swapprev
assert_above "$second_title" "$first_title" 'portrait swapprev order'

status 'move second portrait window downward'
focus_window_by_title "$second_title"
layout_msg swapnext
assert_below "$second_title" "$first_title" 'portrait swapnext order'

status 'close second portrait window'
close_window_by_title "$second_title"
wait_for_count 1

status 'reopen portrait window at bottom'
spawn_window "$reopened_title" "$workspace_name"
wait_for_count 2
assert_identity "$reopened_title"
wait_for_workspace "$reopened_title" "$workspace_name"
assert_below "$reopened_title" "$first_title" 'reopened portrait spawn order'

status 'cleanup e2e windows'
cleanup_test_windows || fail 'test windows did not clean up'

printf 'PASS portrait_rows e2e\n'
