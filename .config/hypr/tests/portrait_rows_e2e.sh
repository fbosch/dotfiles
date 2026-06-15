#!/usr/bin/env bash

set -euo pipefail

config_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${config_dir}/runtime/lib/hypr-ipc.sh"

portrait_monitor="${HYPR_E2E_PORTRAIT_MONITOR:-HDMI-A-2}"
workspace_name="${HYPR_E2E_WORKSPACE:-}"
workspace=""
window_class="opencode-hypr-portrait-e2e"
title_prefix="${window_class}-$(date +%s)-$$"
sleep_seconds="${HYPR_E2E_SLEEP_SECONDS:-300}"
original_workspace=""
original_layout=""

skip() {
	printf 'SKIP %s\n' "$1"
	exit 0
}

fail() {
	printf 'FAIL %s\n' "$1" >&2
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

select_test_workspace() {
	if [[ -n "$workspace_name" ]]; then
		workspace="$workspace_name"
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
		--arg workspace "$workspace_name" \
		'[
			.[]
			| select(.workspace.name == $workspace)
			| select(
				.class == $class
				or .initialClass == $class
				or ((.title // "") | startswith($prefix))
				or ((.initialTitle // "") | startswith($prefix))
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

focus_window_by_title() {
	local title="$1"
	local address="$(window_address "$title")"
	local selector=""
	local dispatcher=""

	[[ -n "$address" ]] || fail "missing window address for ${title}"
	selector="$(lua_quote "address:${address}")"
	printf -v dispatcher 'hl.dsp.focus({ window = %s })' "$selector"
	hypr_eval_dispatch "$dispatcher"
}

layout_msg() {
	local message="$1"
	local message_arg="$(lua_quote "$message")"
	local dispatcher=""

	printf -v dispatcher 'hl.dsp.layout(%s)' "$message_arg"
	hypr_eval_dispatch "$dispatcher"
	sleep 0.1
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

hypr_query j/monitors | jq -e --arg monitor "$portrait_monitor" 'any(.[]; .name == $monitor)' >/dev/null \
	|| skip "portrait monitor not present: ${portrait_monitor}"

original_workspace="$(hypr_query j/activeworkspace | jq -r '.name')"
original_layout="$(hyprctl getoption general:layout -j | jq -r '.str // empty')"
select_test_workspace
trap restore_session EXIT

cleanup_test_windows
portrait_monitor_arg="$(lua_quote "$portrait_monitor")"
workspace_arg="$(lua_quote "$workspace")"
printf -v dispatcher 'hl.dsp.focus({ monitor = %s })' "$portrait_monitor_arg"
hypr_eval_dispatch "$dispatcher"
printf -v dispatcher 'hl.dsp.focus({ workspace = %s })' "$workspace_arg"
hypr_eval_dispatch "$dispatcher"
printf -v dispatcher 'hl.dsp.workspace.move({ workspace = %s, monitor = %s })' "$workspace_arg" "$portrait_monitor_arg"
hypr_eval_dispatch "$dispatcher"
printf -v dispatcher 'hl.dsp.focus({ workspace = %s })' "$workspace_arg"
hypr_eval_dispatch "$dispatcher"
printf -v dispatcher 'hl.dsp.focus({ monitor = %s })' "$portrait_monitor_arg"
hypr_eval_dispatch "$dispatcher"

hypr_query j/monitors | jq -e --arg monitor "$portrait_monitor" --arg workspace "$workspace_name" '
	any(.[]; .name == $monitor and .focused == true and .activeWorkspace.name == $workspace)
' >/dev/null || fail "portrait monitor did not focus test workspace ${workspace_name}"

first_title="${title_prefix}-first"
second_title="${title_prefix}-second"
reopened_title="${title_prefix}-reopened"

spawn_window "$first_title"
wait_for_count 1
assert_identity "$first_title"

spawn_window "$second_title"
wait_for_count 2
assert_identity "$second_title"
assert_below "$second_title" "$first_title" 'initial portrait spawn order'

focus_window_by_title "$second_title"
layout_msg swapprev
assert_above "$second_title" "$first_title" 'portrait swapprev order'

focus_window_by_title "$second_title"
layout_msg swapnext
assert_below "$second_title" "$first_title" 'portrait swapnext order'

close_window_by_title "$second_title"
wait_for_count 1

spawn_window "$reopened_title"
wait_for_count 2
assert_identity "$reopened_title"
assert_below "$reopened_title" "$first_title" 'reopened portrait spawn order'

printf 'PASS portrait_rows e2e spawn/move/reopen order\n'
