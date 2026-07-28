#!/usr/bin/env bash
set -euo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"
herdr_socket="${HERDR_SOCKET_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr/herdr.sock}"

while IFS= read -r workspace_id; do
	[[ -n "$workspace_id" ]] || continue

	panes="$("$herdr_bin" pane list --workspace "$workspace_id")"
	while IFS= read -r pane_id; do
		[[ -n "$pane_id" ]] || continue

		processes=""
		for _ in {1..20}; do
			if processes="$("$herdr_bin" pane process-info --pane "$pane_id" 2>/dev/null)"; then
				break
			fi
			sleep 0.1
		done
		[[ -n "$processes" ]] || continue
		if jq -e '.result.process_info.foreground_processes[]? | select(.name == "nvim")' >/dev/null <<<"$processes"; then
			continue
		fi

		if jq -e '[.result.process_info.foreground_processes[]?.name] | any(. == "fish" or . == "bash" or . == "zsh" or . == "sh")' >/dev/null <<<"$processes"; then
			nvim_session="herdr-${pane_id/:/-}"
			"$herdr_bin" pane run "$pane_id" "HERDR_ENV=1 HERDR_PANE_ID=$pane_id HERDR_SOCKET_PATH=$herdr_socket NVIM_SESSION=$nvim_session HERDR_MINI_SESSION_RESTORE=1 exec nvim"
		fi
	done < <(jq -r '.result.panes[]? | select(.label == "nvim") | .pane_id' <<<"$panes")
done < <("$herdr_bin" workspace list | jq -r '.result.workspaces[]?.workspace_id')
