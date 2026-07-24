#!/usr/bin/env bash
set -euo pipefail

workflow="${1:?workflow is required}"
herdr_bin="${HERDR_BIN_PATH:-herdr}"
context="${HERDR_PLUGIN_CONTEXT_JSON:?missing Herdr plugin context}"

pane_id="${HERDR_PANE_ID:-$(jq -er '.focused_pane_id' <<<"$context")}"
workspace_id="${HERDR_WORKSPACE_ID:-$(jq -er '.workspace_id' <<<"$context")}"
tab_id="${HERDR_TAB_ID:-$(jq -er '.focused_tab_id // .tab_id' <<<"$context")}"
cwd="$(jq -er '.focused_pane_cwd // .workspace_cwd' <<<"$context")"

forward_to_neovim() {
	local key="$1"
	local processes
	processes="$("$herdr_bin" pane process-info --pane "$pane_id")"
	if jq -e '.result.process_info.foreground_processes[]? | select(.name == "nvim")' >/dev/null <<<"$processes"; then
		exec "$herdr_bin" pane send-keys "$pane_id" "$key"
	fi
}

open_popup() {
	exec "$herdr_bin" plugin pane open \
		--plugin "$HERDR_PLUGIN_ID" \
		--entrypoint "$workflow" \
		--placement popup \
		--cwd "$cwd" \
		--focus
}

mprocs_state_file="$HERDR_PLUGIN_CONFIG_DIR/mprocs-${workspace_id}.state"

open_or_focus_mprocs() {
	local mprocs_tab previous_tab root result
	mkdir -p "$HERDR_PLUGIN_CONFIG_DIR"
	mprocs_tab="$("$herdr_bin" tab list --workspace "$workspace_id" | jq -r '[.result.tabs[]? | select(.label == "mprocs") | .tab_id] | first // empty')"
	if [[ -n "$mprocs_tab" ]]; then
		if [[ "$tab_id" == "$mprocs_tab" ]]; then
			if [[ -f "$mprocs_state_file" ]] && read -r previous_tab <"$mprocs_state_file" && "$herdr_bin" tab get "$previous_tab" >/dev/null 2>&1; then
				exec "$herdr_bin" tab focus "$previous_tab"
			fi
			exit 0
		fi

		printf '%s\n' "$tab_id" >"$mprocs_state_file"
		exec "$herdr_bin" tab focus "$mprocs_tab"
	fi

	root="$("$HERDR_PLUGIN_ROOT/scripts/project.sh" root "$cwd")"
	result="$("$herdr_bin" plugin pane open \
		--plugin "$HERDR_PLUGIN_ID" \
		--entrypoint mprocs \
		--placement tab \
		--cwd "$root" \
		--focus)"
	mprocs_tab="$(jq -er '.result.plugin_pane.pane.tab_id' <<<"$result")"
	"$herdr_bin" tab rename "$mprocs_tab" mprocs
	printf '%s\n' "$tab_id" >"$mprocs_state_file"
}

case "$workflow" in
	terminal)
		forward_to_neovim "alt+t"
		open_popup
		;;
	mprocs)
		forward_to_neovim "alt+m"
		open_or_focus_mprocs
		;;
	lazygit)
		forward_to_neovim "alt+g"
		open_popup
		;;
	btop)
		forward_to_neovim "alt+b"
		open_popup
		;;
	checkmate)
		forward_to_neovim "alt+c"
		open_popup
		;;
	scooter)
		forward_to_neovim "alt+s"
		open_popup
		;;
	*)
		printf 'Unknown workflow: %s\n' "$workflow" >&2
		exit 2
		;;
esac
