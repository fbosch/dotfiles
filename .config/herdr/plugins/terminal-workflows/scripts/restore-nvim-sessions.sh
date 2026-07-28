#!/usr/bin/env bash
set -euo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"

while IFS= read -r workspace_id; do
	[[ -n "$workspace_id" ]] || continue

	panes="$("$herdr_bin" pane list --workspace "$workspace_id")"
	while IFS= read -r pane_id; do
		[[ -n "$pane_id" ]] || continue

		processes="$("$herdr_bin" pane process-info --pane "$pane_id")"
		if jq -e '.result.process_info.foreground_processes[]? | select(.name == "nvim")' >/dev/null <<<"$processes"; then
			continue
		fi

		if jq -e '[.result.process_info.foreground_processes[]?.name] | any(. == "fish" or . == "bash" or . == "zsh" or . == "sh")' >/dev/null <<<"$processes"; then
			"$herdr_bin" pane run "$pane_id" "HERDR_MINI_SESSION_RESTORE=1 exec nvim"
		fi
	done < <(jq -r '.result.panes[]? | select(.label == "nvim" and .agent_session == null) | .pane_id' <<<"$panes")
done < <("$herdr_bin" workspace list | jq -r '.result.workspaces[]?.workspace_id')
