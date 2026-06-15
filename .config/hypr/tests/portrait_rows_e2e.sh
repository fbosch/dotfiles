#!/usr/bin/env bash

set -euo pipefail

config_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${config_dir}/runtime/lib/hypr-ipc.sh"

portrait_monitor="${HYPR_E2E_PORTRAIT_MONITOR:-HDMI-A-2}"
ultrawide_monitor="${HYPR_E2E_ULTRAWIDE_MONITOR:-DP-2}"
workspace_name="${HYPR_E2E_WORKSPACE:-}"
workspace=""
ultrawide_workspace_name="${HYPR_E2E_ULTRAWIDE_WORKSPACE:-}"
ultrawide_workspace=""
window_class="opencode-hypr-portrait-e2e"
title_prefix="${window_class}-$(date +%s)-$$"
sleep_seconds="${HYPR_E2E_SLEEP_SECONDS:-300}"
original_workspace=""
original_layout=""
current_step="startup"

status() {
	current_step="$1"
	printf 'STEP %s\n' "$current_step"
}

skip() {
	printf 'SKIP %s\n' "$1"
	exit 0
}

fail() {
	printf 'FAIL %s: %s\n' "$current_step" "$1" >&2
	exit 1
}

lua_quote() {
	local value="$1"

	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	value="${value//$'\n'/\\n}"
	value="${value//$'\r'/\\r}"
	value="${value//$'\t'/\\t}"
	printf '"%s"' "$value"
}

shell_quote() {
	printf '%q' "$1"
}

hypr_eval_dispatch() {
	local dispatcher="$1"

	hyprctl eval "hl.dispatch(${dispatcher})" >/dev/null
}

clients_json() {
	hypr_query j/clients
}

select_test_workspaces() {
	if [[ -n "$workspace_name" ]]; then
		workspace="$workspace_name"
	fi
	if [[ -n "$workspace" ]]; then
		return
	fi

	for candidate in 9 8 7 6 5 4 3; do
		if ! hyprctl workspaces -j | jq -e --arg name "$candidate" 'any(.[]; .name == $name)' >/dev/null; then
			workspace_name="$candidate"
			workspace="$candidate"
			return
		fi
	done

	skip 'no free numeric workspace in 3..9 for portrait e2e'
}

test_clients() {
	clients_json | jq \
		--arg class "$window_class" \
		--arg prefix "$title_prefix" \
		'[
			.[]
			| select(
				(.class == $class or .initialClass == $class)
				and (((.title // "") | startswith($prefix)) or ((.initialTitle // "") | startswith($prefix)))
			)
		]'
}

test_window_count() {
	test_clients | jq 'length'
}

window_address() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .address // empty'
}

window_y() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .at[1] // empty'
}

window_x() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .at[0] // empty'
}

window_workspace() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .workspace.name // empty'
}

active_window_address() {
	hypr_query j/activewindow | jq -r '.address // empty'
}

wait_for_count() {
	local expected="$1"
	local count=""

	for _ in {1..80}; do
		count="$(test_window_count)"
		if [[ "$count" == "$expected" ]]; then
			return
		fi

		sleep 0.1
	done

	fail "expected ${expected} test windows, found ${count}"
}

wait_for_no_title() {
	local title="$1"

	for _ in {1..80}; do
		if [[ -z "$(window_address "$title")" ]]; then
			return
		fi

		sleep 0.1
	done

	fail "window did not close: ${title}"
}

wait_for_test_windows_gone() {
	for _ in {1..80}; do
		if [[ "$(test_window_count)" == "0" ]]; then
			return
		fi

		sleep 0.1
	done

	return 1
}

close_window_by_title() {
	local title="$1"
	local address="$(window_address "$title")"
	local selector=""
	local dispatcher=""

	[[ -n "$address" ]] || return
	selector="$(lua_quote "address:${address}")"
	printf -v dispatcher 'hl.dsp.window.close(%s)' "$selector"
	hypr_eval_dispatch "$dispatcher" || true
	wait_for_no_title "$title"
}

cleanup_test_windows() {
	local addresses=""

	addresses="$(test_clients | jq -r '.[].address')"
	while IFS= read -r address; do
		[[ -n "$address" ]] || continue
		local selector="$(lua_quote "address:${address}")"
		local dispatcher=""
		printf -v dispatcher 'hl.dsp.window.close(%s)' "$selector"
		hypr_eval_dispatch "$dispatcher" || true
	done <<< "$addresses"

	if wait_for_test_windows_gone; then
		return
	fi

	addresses="$(test_clients | jq -r '.[].address')"
	while IFS= read -r address; do
		[[ -n "$address" ]] || continue
		local selector="$(lua_quote "address:${address}")"
		local dispatcher=""
		printf -v dispatcher 'hl.dsp.window.kill(%s)' "$selector"
		hypr_eval_dispatch "$dispatcher" || true
	done <<< "$addresses"

	wait_for_test_windows_gone
}

restore_session() {
	cleanup_test_windows || true
	if [[ -n "$original_workspace" ]]; then
		local workspace_arg="$(lua_quote "$original_workspace")"
		local dispatcher=""
		printf -v dispatcher 'hl.dsp.focus({ workspace = %s })' "$workspace_arg"
		hypr_eval_dispatch "$dispatcher" || true
	fi
	if [[ -n "$original_layout" ]]; then
		hyprctl keyword general:layout "$original_layout" >/dev/null || true
	fi
}

terminal_command() {
	local title="$1"
	local class_arg="$(shell_quote "$window_class")"
	local title_arg="$(shell_quote "$title")"
	local sleep_arg="$(shell_quote "sleep ${sleep_seconds}")"

	command -v foot >/dev/null 2>&1 || return 1
	printf 'foot --app-id %s --title %s sh -c %s' "$class_arg" "$title_arg" "$sleep_arg"
}

spawn_window() {
	local title="$1"
	local command=""
	local command_arg=""
	local dispatcher=""

	command="$(terminal_command "$title")" || skip 'foot not found for e2e window spawning'
	command_arg="$(lua_quote "$command")"
	printf -v dispatcher 'hl.dsp.exec_cmd(%s)' "$command_arg"
	hypr_eval_dispatch "$dispatcher"
}

focus_monitor_workspace() {
	local monitor="$1"
	local target_workspace="$2"
	local monitor_arg="$(lua_quote "$monitor")"
	local workspace_arg="$(lua_quote "$target_workspace")"
	local dispatcher=""

	printf -v dispatcher 'hl.dsp.focus({ monitor = %s })' "$monitor_arg"
	hypr_eval_dispatch "$dispatcher"
	printf -v dispatcher 'hl.dsp.focus({ workspace = %s })' "$workspace_arg"
	hypr_eval_dispatch "$dispatcher"
	printf -v dispatcher 'hl.dsp.workspace.move({ workspace = %s, monitor = %s })' "$workspace_arg" "$monitor_arg"
	hypr_eval_dispatch "$dispatcher"
	printf -v dispatcher 'hl.dsp.focus({ workspace = %s })' "$workspace_arg"
	hypr_eval_dispatch "$dispatcher"
	printf -v dispatcher 'hl.dsp.focus({ monitor = %s })' "$monitor_arg"
	hypr_eval_dispatch "$dispatcher"
}

focus_monitor() {
	local monitor="$1"
	local monitor_arg="$(lua_quote "$monitor")"
	local dispatcher=""

	printf -v dispatcher 'hl.dsp.focus({ monitor = %s })' "$monitor_arg"
	hypr_eval_dispatch "$dispatcher"
}

focus_window_by_title() {
	local title="$1"
	local address="$(window_address "$title")"
	local selector=""
	local dispatcher=""

	[[ -n "$address" ]] || fail "missing window address for ${title}"
	selector="$(lua_quote "address:${address}")"
	printf -v dispatcher 'hl.dsp.focus({ window = %s })' "$selector"
	for _ in {1..80}; do
		hypr_eval_dispatch "$dispatcher"
		if [[ "$(active_window_address)" == "$address" ]]; then
			return
		fi

		sleep 0.1
	done

	fail "window did not become active: ${title}"
}

layout_msg() {
	local message="$1"
	local message_arg="$(lua_quote "$message")"
	local dispatcher=""

	printf -v dispatcher 'hl.dsp.layout(%s)' "$message_arg"
	hypr_eval_dispatch "$dispatcher"
	sleep 0.1
}

move_window_between_monitors() {
	local direction="$1"
	local direction_arg="$(lua_quote "$direction")"

	hyprctl eval "require('lib.window').move(${direction_arg})()" >/dev/null
	sleep 0.2
}

assert_identity() {
	local title="$1"

	test_clients | jq -e --arg title "$title" --arg class "$window_class" '
		any(.[];
			(.title == $title or .initialTitle == $title)
			and (.class == $class or .initialClass == $class)
		)
	' >/dev/null || fail "missing expected foot identity for ${title}"
}

assert_below() {
	local lower_title="$1"
	local upper_title="$2"
	local message="$3"
	local lower_y="$(window_y "$lower_title")"
	local upper_y="$(window_y "$upper_title")"

	[[ -n "$lower_y" ]] || fail "missing window y for ${lower_title}"
	[[ -n "$upper_y" ]] || fail "missing window y for ${upper_title}"
	if (( lower_y <= upper_y )); then
		fail "${message}: expected ${lower_title} below ${upper_title}, got y=${lower_y} <= ${upper_y}"
	fi
}

assert_left_of() {
	local left_title="$1"
	local right_title="$2"
	local message="$3"
	local left_x="$(window_x "$left_title")"
	local right_x="$(window_x "$right_title")"

	[[ -n "$left_x" ]] || fail "missing window x for ${left_title}"
	[[ -n "$right_x" ]] || fail "missing window x for ${right_title}"
	if (( left_x >= right_x )); then
		fail "${message}: expected ${left_title} left of ${right_title}, got x=${left_x} >= ${right_x}"
	fi
}

wait_for_workspace() {
	local title="$1"
	local expected="$2"
	local actual=""

	for _ in {1..80}; do
		actual="$(window_workspace "$title")"
		if [[ "$actual" == "$expected" ]]; then
			return
		fi

		sleep 0.1
	done

	fail "expected ${title} on workspace ${expected}, found ${actual}"
}

assert_above() {
	local upper_title="$1"
	local lower_title="$2"
	local message="$3"
	local upper_y="$(window_y "$upper_title")"
	local lower_y="$(window_y "$lower_title")"

	[[ -n "$upper_y" ]] || fail "missing window y for ${upper_title}"
	[[ -n "$lower_y" ]] || fail "missing window y for ${lower_title}"
	if (( upper_y >= lower_y )); then
		fail "${message}: expected ${upper_title} above ${lower_title}, got y=${upper_y} >= ${lower_y}"
	fi
}

command -v hyprctl >/dev/null 2>&1 || skip 'hyprctl not found'
command -v jq >/dev/null 2>&1 || skip 'jq not found'
[[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] || skip 'not running inside Hyprland'

status 'check monitors and select workspace'
hypr_query j/monitors | jq -e --arg monitor "$portrait_monitor" 'any(.[]; .name == $monitor)' >/dev/null \
	|| skip "portrait monitor not present: ${portrait_monitor}"
hypr_query j/monitors | jq -e --arg monitor "$ultrawide_monitor" 'any(.[]; .name == $monitor)' >/dev/null \
	|| skip "ultrawide monitor not present: ${ultrawide_monitor}"

original_workspace="$(hypr_query j/activeworkspace | jq -r '.name')"
original_layout="$(hyprctl getoption general:layout -j | jq -r '.str // empty')"
select_test_workspaces
trap restore_session EXIT

status 'cleanup previous matching e2e windows'
cleanup_test_windows
status 'focus portrait test workspace'
focus_monitor_workspace "$portrait_monitor" "$workspace"

hypr_query j/monitors | jq -e --arg monitor "$portrait_monitor" --arg workspace "$workspace_name" '
	any(.[]; .name == $monitor and .focused == true and .activeWorkspace.name == $workspace)
' >/dev/null || fail "portrait monitor did not focus test workspace ${workspace_name}"

first_title="${title_prefix}-first"
second_title="${title_prefix}-second"
reopened_title="${title_prefix}-reopened"
ultrawide_title="${title_prefix}-ultrawide"

status 'spawn first portrait window'
spawn_window "$first_title"
wait_for_count 1
assert_identity "$first_title"

status 'spawn second portrait window at bottom'
spawn_window "$second_title"
wait_for_count 2
assert_identity "$second_title"
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
spawn_window "$reopened_title"
wait_for_count 2
assert_identity "$reopened_title"
assert_below "$reopened_title" "$first_title" 'reopened portrait spawn order'

status 'spawn ultrawide reference window'
focus_monitor "$ultrawide_monitor"
ultrawide_workspace_name="$(hypr_query j/monitors | jq -r --arg monitor "$ultrawide_monitor" 'first(.[] | select(.name == $monitor)) | .activeWorkspace.name')"
spawn_window "$ultrawide_title"
wait_for_count 3
assert_identity "$ultrawide_title"

status 'move portrait window to ultrawide left edge'
focus_window_by_title "$reopened_title"
move_window_between_monitors right
wait_for_workspace "$reopened_title" "$ultrawide_workspace_name"
assert_left_of "$reopened_title" "$ultrawide_title" 'portrait to ultrawide transfer order'

status 'move ultrawide window back to portrait bottom'
focus_window_by_title "$reopened_title"
move_window_between_monitors down
wait_for_workspace "$reopened_title" "$workspace_name"
assert_below "$reopened_title" "$first_title" 'ultrawide to portrait transfer order'

status 'cleanup e2e windows'
cleanup_test_windows || fail 'test windows did not clean up'

printf 'PASS portrait_rows e2e spawn/move/reopen/transfer order\n'
