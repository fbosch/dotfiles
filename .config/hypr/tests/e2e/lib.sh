#!/usr/bin/env bash

set -euo pipefail

e2e_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config_dir="$(cd -- "${e2e_dir}/../.." && pwd)"

# shellcheck disable=SC1091
source "${config_dir}/runtime/lib/hypr-ipc.sh"

portrait_monitor="${HYPR_E2E_PORTRAIT_MONITOR:-HDMI-A-2}"
ultrawide_monitor="${HYPR_E2E_ULTRAWIDE_MONITOR:-DP-2}"
window_class="opencode-hypr-e2e"
sleep_seconds="${HYPR_E2E_SLEEP_SECONDS:-300}"
current_step="startup"
original_workspace=""
original_layout=""
title_prefix=""
e2e_window_addresses=()

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

test_client_by_address() {
	local address="$1"

	clients_json | jq \
		--arg address "$address" \
		--arg class "$window_class" \
		--arg prefix "$title_prefix" \
		'first(
			.[]
			| select(.address == $address)
			| select(
				(.class == $class or .initialClass == $class)
				and (((.title // "") | startswith($prefix)) or ((.initialTitle // "") | startswith($prefix)))
			)
		) // empty'
}

record_window_address() {
	local address="$1"
	local existing=""

	[[ -n "$address" ]] || return
	for existing in "${e2e_window_addresses[@]}"; do
		[[ "$existing" == "$address" ]] && return
	done

	e2e_window_addresses+=("$address")
}

window_address() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .address // empty'
}

window_x() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .at[0] // empty'
}

window_y() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .at[1] // empty'
}

window_workspace() {
	local title="$1"

	test_clients | jq -r --arg title "$title" 'first(.[] | select(.title == $title or .initialTitle == $title)) | .workspace.name // empty'
}

active_window_address() {
	hypr_query j/activewindow | jq -r '.address // empty'
}

pick_free_workspace() {
	local candidate=""

	for candidate in 99 98 97 96 95 94 93 92 91 90; do
		if ! hyprctl workspaces -j | jq -e --arg name "$candidate" 'any(.[]; .name == $name)' >/dev/null; then
			printf '%s\n' "$candidate"
			return
		fi
	done

	return 1
}

set_global_layout() {
	local layout="$1"
	local layout_arg="$(lua_quote "$layout")"

	hyprctl eval "hl.config({ general = { layout = ${layout_arg} } })" >/dev/null
}

require_runtime() {
	command -v hyprctl >/dev/null 2>&1 || skip 'hyprctl not found'
	command -v jq >/dev/null 2>&1 || skip 'jq not found'
	command -v foot >/dev/null 2>&1 || skip 'foot not found'
	[[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] || skip 'not running inside Hyprland'

	hypr_query j/monitors | jq -e --arg monitor "$portrait_monitor" 'any(.[]; .name == $monitor)' >/dev/null \
		|| skip "portrait monitor not present: ${portrait_monitor}"
	hypr_query j/monitors | jq -e --arg monitor "$ultrawide_monitor" 'any(.[]; .name == $monitor)' >/dev/null \
		|| skip "ultrawide monitor not present: ${ultrawide_monitor}"

	original_workspace="$(hypr_query j/activeworkspace | jq -r '.name')"
	original_layout="$(hyprctl getoption general:layout -j | jq -r '.str // empty')"
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
	local address=""
	local found=""

	for _ in {1..80}; do
		found=""
		for address in "${e2e_window_addresses[@]}"; do
			if [[ -n "$(test_client_by_address "$address")" ]]; then
				found="1"
				break
			fi
		done

		if [[ -z "$found" ]]; then
			return
		fi

		sleep 0.1
	done

	return 1
}

cleanup_test_windows() {
	local address=""
	local pkill_pattern="foot .*--app-id ${window_class} .*--title ${title_prefix}"

	for address in "${e2e_window_addresses[@]}"; do
		[[ -n "$address" ]] || continue
		[[ -n "$(test_client_by_address "$address")" ]] || continue
		local selector="$(lua_quote "address:${address}")"
		local dispatcher=""
		printf -v dispatcher 'hl.dsp.window.close(%s)' "$selector"
		hypr_eval_dispatch "$dispatcher" || true
	done

	if wait_for_test_windows_gone; then
		return
	fi

	pkill -f -- "$pkill_pattern" || true

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
		set_global_layout "$original_layout" || true
	fi
}

spawn_window() {
	local title="$1"
	local target_workspace="${2:-}"
	local class_arg="$(shell_quote "$window_class")"
	local title_arg="$(shell_quote "$title")"
	local sleep_arg="$(shell_quote "sleep ${sleep_seconds}")"
	local command=""
	local command_arg=""
	local dispatcher=""

	printf -v command 'foot --app-id %s --title %s sh -c %s' "$class_arg" "$title_arg" "$sleep_arg"
	command_arg="$(lua_quote "$command")"
	if [[ -n "$target_workspace" ]]; then
		local workspace_arg="$(lua_quote "$target_workspace")"
		printf -v dispatcher 'hl.dsp.exec_cmd(%s, { workspace = %s })' "$command_arg" "$workspace_arg"
	else
		printf -v dispatcher 'hl.dsp.exec_cmd(%s)' "$command_arg"
	fi
	hypr_eval_dispatch "$dispatcher"
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

monitor_workspace() {
	local monitor="$1"

	hypr_query j/monitors | jq -r --arg monitor "$monitor" 'first(.[] | select(.name == $monitor)) | .activeWorkspace.name // empty'
}

apply_workspace_rule() {
	local workspace="$1"
	local monitor="$2"
	local layout="$3"
	local workspace_arg="$(lua_quote "$workspace")"
	local monitor_arg="$(lua_quote "$monitor")"
	local layout_arg="$(lua_quote "$layout")"

	hyprctl eval "hl.workspace_rule({ workspace = ${workspace_arg}, monitor = ${monitor_arg}, layout = ${layout_arg} })" >/dev/null
}

workspace_layout() {
	local workspace="$1"

	hyprctl workspaces -j | jq -r --arg workspace "$workspace" 'first(.[] | select(.name == $workspace)) | .tiledLayout // empty'
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

custom_move() {
	local direction="$1"
	local direction_arg="$(lua_quote "$direction")"

	hyprctl eval "require('lib.window').move(${direction_arg})()" >/dev/null
	sleep 0.2
}

assert_identity() {
	local title="$1"
	local address=""

	address="$(test_clients | jq -r --arg title "$title" --arg class "$window_class" '
		first(.[]
			| select(.title == $title or .initialTitle == $title)
			| select(.class == $class or .initialClass == $class)
		) | .address // empty
	')"
	[[ -n "$address" ]] || fail "missing expected foot identity for ${title}"
	record_window_address "$address"

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

assert_right_of() {
	local right_title="$1"
	local left_title="$2"
	local message="$3"
	local right_x="$(window_x "$right_title")"
	local left_x="$(window_x "$left_title")"

	[[ -n "$right_x" ]] || fail "missing window x for ${right_title}"
	[[ -n "$left_x" ]] || fail "missing window x for ${left_title}"
	if (( right_x <= left_x )); then
		fail "${message}: expected ${right_title} right of ${left_title}, got x=${right_x} <= ${left_x}"
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

assert_focused_monitor_workspace() {
	local monitor="$1"
	local expected_workspace="$2"

	hypr_query j/monitors | jq -e --arg monitor "$monitor" --arg workspace "$expected_workspace" '
		any(.[]; .name == $monitor and .activeWorkspace.name == $workspace)
	' >/dev/null || fail "${monitor} did not focus workspace ${expected_workspace}"
}

assert_workspace_layout() {
	local workspace="$1"
	local expected_layout="$2"
	local actual_layout="$(workspace_layout "$workspace")"

	[[ "$actual_layout" == "$expected_layout" ]] || fail "workspace ${workspace} uses ${actual_layout:-unknown layout}, expected ${expected_layout}"
}
