#!/usr/bin/env bash
set -euo pipefail

event="${HERDR_PLUGIN_EVENT_JSON:?missing Herdr plugin event}"
herdr_bin="${HERDR_BIN_PATH:-herdr}"
metadata_dir="${NVIM_SESSION_METADATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/nvim/.sessions/.metadata}"
event_type="$(jq -er '.event // .data.type // .type' <<<"$event")"

[[ -d "$metadata_dir" ]] || exit 0

if [[ "$event_type" == "pane.moved" || "$event_type" == "pane_moved" ]]; then
	previous_pane_id="$(jq -er '.data.previous_pane_id // .previous_pane_id' <<<"$event")"
	pane_id="$(jq -er '.data.pane.pane_id // .pane.pane_id' <<<"$event")"
	tab_id="$(jq -er '.data.pane.tab_id // .pane.tab_id' <<<"$event")"
	workspace_id="$(jq -er '.data.pane.workspace_id // .pane.workspace_id' <<<"$event")"

	for metadata_path in "$metadata_dir"/*.json; do
		[[ -e "$metadata_path" ]] || continue
		jq -e --arg pane_id "$previous_pane_id" '.herdr_managed == true and .herdr_pane_id == $pane_id' "$metadata_path" >/dev/null || continue
		temporary_path="$(mktemp "${metadata_path}.XXXXXX")"
		jq --arg pane_id "$pane_id" --arg tab_id "$tab_id" --arg workspace_id "$workspace_id" '
			.herdr_pane_id = $pane_id
			| .herdr_tab_id = $tab_id
			| .herdr_workspace_id = $workspace_id
		' "$metadata_path" >"$temporary_path"
		mv "$temporary_path" "$metadata_path"
	done
	exit 0
fi

case "$event_type" in
	"pane.closed" | "pane_closed")
		metadata_key="herdr_pane_id"
		closed_id="$(jq -er '.data.pane_id // .pane_id' <<<"$event")"
		;;
	"tab.closed" | "tab_closed")
		metadata_key="herdr_tab_id"
		closed_id="$(jq -er '.data.tab_id // .tab_id' <<<"$event")"
		;;
	"workspace.closed" | "workspace_closed")
		metadata_key="herdr_workspace_id"
		closed_id="$(jq -er '.data.workspace_id // .workspace_id' <<<"$event")"
		;;
	*)
		exit 0
		;;
esac

panes=""
if [[ "$metadata_key" != "herdr_pane_id" ]]; then
	panes="$("$herdr_bin" pane list)"
fi

for metadata_path in "$metadata_dir"/*.json; do
	[[ -e "$metadata_path" ]] || continue
	jq -e --arg key "$metadata_key" --arg closed_id "$closed_id" '.herdr_managed == true and .[$key] == $closed_id' "$metadata_path" >/dev/null || continue

	if [[ -n "$panes" ]]; then
		cwd="$(jq -er '.cwd' "$metadata_path")"
		nvim_session="$(jq -er '.specifier' "$metadata_path")"
		live_pane="$(jq -cr --arg cwd "$cwd" --arg nvim_session "$nvim_session" '
			first(
				.result.panes[]?
				| select(
					.tokens.nvim_session == $nvim_session
					and ((.foreground_cwd == $cwd) or (.cwd == $cwd))
				)
			) // empty
		' <<<"$panes")"
		if [[ -n "$live_pane" ]]; then
			temporary_path="$(mktemp "${metadata_path}.XXXXXX")"
			jq --arg pane_id "$(jq -r '.pane_id' <<<"$live_pane")" --arg tab_id "$(jq -r '.tab_id' <<<"$live_pane")" --arg workspace_id "$(jq -r '.workspace_id' <<<"$live_pane")" '
				.herdr_pane_id = $pane_id
				| .herdr_tab_id = $tab_id
				| .herdr_workspace_id = $workspace_id
			' "$metadata_path" >"$temporary_path"
			mv "$temporary_path" "$metadata_path"
			continue
		fi
	fi

	temporary_path="$(mktemp "${metadata_path}.XXXXXX")"
	jq '.restore_pending = false' "$metadata_path" >"$temporary_path"
	mv "$temporary_path" "$metadata_path"
done
