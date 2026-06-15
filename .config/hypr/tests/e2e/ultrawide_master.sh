#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/lib.sh"

title_prefix="${window_class}-ultrawide-$(date +%s)-$$"

status 'check runtime and select ultrawide workspace'
require_runtime
workspace_name="${HYPR_E2E_ULTRAWIDE_WORKSPACE:-$(pick_free_workspace || true)}"
[[ -n "$workspace_name" ]] || skip 'no free numeric workspace in 3..9 for ultrawide e2e'
trap restore_session EXIT

status 'apply ultrawide workspace rule'
apply_workspace_rule "$workspace_name" "$ultrawide_monitor" 'lua:ultrawide_master'
set_global_layout 'lua:ultrawide_master'

status 'focus ultrawide monitor'
focus_monitor_workspace "$ultrawide_monitor" "$workspace_name"

first_title="${title_prefix}-first"
second_title="${title_prefix}-second"
reopened_title="${title_prefix}-reopened"

status 'spawn first ultrawide window'
spawn_window "$first_title" "$workspace_name"
wait_for_count 1
assert_identity "$first_title"
wait_for_workspace "$first_title" "$workspace_name"
assert_workspace_layout "$workspace_name" 'lua:ultrawide_master'

status 'verify ultrawide test workspace'
assert_focused_monitor_workspace "$ultrawide_monitor" "$workspace_name"

status 'spawn second ultrawide window to the right'
spawn_window "$second_title" "$workspace_name"
wait_for_count 2
assert_identity "$second_title"
wait_for_workspace "$second_title" "$workspace_name"
assert_right_of "$second_title" "$first_title" 'initial ultrawide spawn order'

status 'move second ultrawide window leftward'
focus_window_by_title "$second_title"
layout_msg swapprev
assert_left_of "$second_title" "$first_title" 'ultrawide swapprev order'

status 'move second ultrawide window rightward'
focus_window_by_title "$second_title"
layout_msg swapnext
assert_right_of "$second_title" "$first_title" 'ultrawide swapnext order'

status 'close second ultrawide window'
close_window_by_title "$second_title"
wait_for_count 1

status 'reopen ultrawide window to the right'
spawn_window "$reopened_title" "$workspace_name"
wait_for_count 2
assert_identity "$reopened_title"
wait_for_workspace "$reopened_title" "$workspace_name"
assert_right_of "$reopened_title" "$first_title" 'reopened ultrawide spawn order'

status 'cleanup e2e windows'
cleanup_test_windows || fail 'test windows did not clean up'

printf 'PASS ultrawide_master e2e\n'
