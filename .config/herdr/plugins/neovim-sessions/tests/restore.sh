#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

metadata_dir="$test_dir/metadata"
repo_a="$test_dir/repo-a"
repo_b="$test_dir/repo-b"
mkdir -p "$metadata_dir" "$repo_a" "$repo_b"

jq -n \
	--arg cwd "$repo_a" \
	'{
		cwd: $cwd,
		herdr_managed: true,
		herdr_pane_id: "w1:p1",
		restore_pending: true,
		specifier: "session-a"
	}' >"$metadata_dir/a.json"
jq -n \
	--arg cwd "$repo_b" \
	'{
		cwd: $cwd,
		herdr_managed: true,
		herdr_pane_id: "w1:p1",
		restore_pending: true,
		specifier: "session-b"
	}' >"$metadata_dir/b.json"

export NVIM_SESSION_METADATA_DIR="$metadata_dir"
# shellcheck source=.config/herdr/plugins/neovim-sessions/scripts/restore.sh
source "$plugin_root/scripts/restore.sh"

actual="$(pending_neovim_session_for_pane "w1:p1" "$repo_b")"
if [[ "$actual" != "session-b" ]]; then
	printf 'Expected cwd-matched session-b, got %s\n' "${actual:-<empty>}" >&2
	exit 1
fi
