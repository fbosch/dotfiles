#!/usr/bin/env bash
set -euo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"
herdr_socket="${HERDR_SOCKET_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr/herdr.sock}"
herdr_session_path="$(dirname "$herdr_socket")/session.json"

workspace_has_custom_label() {
	local workspace_id="$1"

	jq -e --arg workspace_id "$workspace_id" '
		.workspaces[]? | select(.id == $workspace_id) | .custom_name? != null
	' "$herdr_session_path" >/dev/null 2>&1
}

workspace_label_from_restored_panes() {
	local workspace_id="$1"
	local workspace panes active_tab_id cwd repo_root candidate best_root label current_label
	local candidate_count best_count=0
	local -a repo_roots=()

	workspace="$("$herdr_bin" workspace get "$workspace_id")"
	active_tab_id="$(jq -er '.result.workspace.active_tab_id' <<<"$workspace")" || return
	workspace_has_custom_label "$workspace_id" && return
	panes="$("$herdr_bin" pane list --workspace "$workspace_id")"

	# Repair only Herdr's derived label; a persisted custom name is user-owned.
	# Prefer the repo represented by the most restored Neovim panes, using the
	# active tab only to break ties.
	while IFS= read -r cwd; do
		[[ -n "$cwd" ]] || continue
		repo_root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)"
		repo_roots+=("${repo_root:-${cwd%/}}")
	done < <(jq -r --arg tab_id "$active_tab_id" '
		(.result.panes[]? | select(.label == "nvim" and .tab_id == $tab_id) | (.foreground_cwd // .cwd // empty)),
		(.result.panes[]? | select(.label == "nvim" and .tab_id != $tab_id) | (.foreground_cwd // .cwd // empty))
	' <<<"$panes")

	for candidate in "${repo_roots[@]}"; do
		candidate_count=0
		for repo_root in "${repo_roots[@]}"; do
			[[ "$repo_root" == "$candidate" ]] && ((candidate_count += 1))
		done
		if ((candidate_count > best_count)); then
			best_root="$candidate"
			best_count="$candidate_count"
		fi
	done
	[[ -n "${best_root:-}" ]] || return

	label="$best_root"
	label="${label##*/}"
	[[ -n "$label" ]] || return

	current_label="$(jq -er '.result.workspace.label' <<<"$workspace")"
	[[ "$current_label" == "$label" ]] || "$herdr_bin" workspace rename "$workspace_id" "$label"
}

for _ in {1..20}; do
	pending=0
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
			if [[ -z "$processes" ]]; then
				pending=1
				continue
			fi
			if jq -e '.result.process_info.foreground_processes[]? | select(.name == "nvim")' >/dev/null <<<"$processes"; then
				continue
			fi

			if jq -e '[.result.process_info.foreground_processes[]?.name] | any(. == "fish" or . == "bash" or . == "zsh" or . == "sh")' >/dev/null <<<"$processes"; then
				nvim_session="herdr-${pane_id/:/-}"
				"$herdr_bin" pane run "$pane_id" "HERDR_ENV=1 HERDR_PANE_ID=$pane_id HERDR_SOCKET_PATH=$herdr_socket NVIM_SESSION=$nvim_session HERDR_MINI_SESSION_RESTORE=1 exec nvim"
			fi
			pending=1
		done < <(jq -r '.result.panes[]? | select(.label == "nvim") | .pane_id' <<<"$panes")
	done < <("$herdr_bin" workspace list | jq -r '.result.workspaces[]?.workspace_id')
	[[ "$pending" -eq 0 ]] && break
	sleep 0.1
done

# Herdr labels a workspace from its first tab, which can be a different repo.
while IFS= read -r workspace_id; do
	[[ -n "$workspace_id" ]] || continue
	workspace_label_from_restored_panes "$workspace_id"
done < <("$herdr_bin" workspace list | jq -r '.result.workspaces[]?.workspace_id')
