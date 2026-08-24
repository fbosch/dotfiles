#!/usr/bin/env bash
set -euo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"
herdr_socket="${HERDR_SOCKET_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr/herdr.sock}"
pane_id="${HERDR_PANE_ID:?focus the shell pane to migrate}"
context="${HERDR_PLUGIN_CONTEXT_JSON:?missing Herdr plugin context}"
cwd="$(jq -er '.focused_pane_cwd // .workspace_cwd' <<<"$context")"
processes="$("$herdr_bin" pane process-info --pane "$pane_id")"

if jq -e '[.result.process_info.foreground_processes[]?.name] | any(. == "fish" or . == "bash" or . == "zsh" or . == "sh")' >/dev/null <<<"$processes"; then
	result="$("$herdr_bin" pane split --pane "$pane_id" --direction right --cwd "$cwd" --no-focus)"
	new_pane_id="$(jq -er '.result.pane.pane_id' <<<"$result")"
	"$herdr_bin" pane rename "$new_pane_id" nvim
	nvim_session="herdr-${new_pane_id/:/-}"
	"$herdr_bin" pane report-metadata "$new_pane_id" --source neovim-sessions --token "nvim_session=$nvim_session"
	"$herdr_bin" pane run "$new_pane_id" "HERDR_ENV=1 HERDR_PANE_ID=$new_pane_id HERDR_SOCKET_PATH=$herdr_socket NVIM_SESSION=$nvim_session HERDR_MINI_SESSION_RESTORE=1 exec nvim"
	"$herdr_bin" pane close "$pane_id"
	exec "$herdr_bin" pane focus "$new_pane_id"
fi

printf 'Quit Neovim before migrating its pane.\n' >&2
exit 1
