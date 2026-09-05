#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(dirname "$script_dir")"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

real_nvim="$(command -v nvim)"
live_data_root="${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
mini_sessions_path="$live_data_root/site/pack/core/opt/mini.sessions"
[[ -d "$mini_sessions_path" ]] || {
	printf 'mini.sessions package not found: %s\n' "$mini_sessions_path" >&2
	exit 1
}

fake_bin="$test_dir/bin"
command_capture="$test_dir/herdr-pane-run.txt"
process_state="$test_dir/neovim-restored"
order_log="$test_dir/restore-order.txt"
pi_environment_capture="$test_dir/pi-environment.txt"
mkdir -p "$fake_bin" "$test_dir/config" "$test_dir/data" "$test_dir/state" "$test_dir/cache"
printf '{"workspaces":[{"id":"w1","custom_name":"fixture"}]}\n' >"$test_dir/session.json"

cat >"$fake_bin/herdr" <<'HERDR'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-}" in
	"workspace list")
		printf '{"result":{"workspaces":[{"workspace_id":"w1"}]}}\n'
		;;
	"workspace get")
		printf '{"result":{"workspace":{"active_tab_id":"w1:t1","label":"fixture"}}}\n'
		;;
	"pane list")
		jq -cn \
			--arg cwd "$HERDR_PANE_CWD" \
			--arg pane_id "$PI_EXPECTED_HERDR_PANE_ID" \
			--arg session "$PI_EXPECTED_NVIM_SESSION" \
			'{result:{panes:[{pane_id:$pane_id,workspace_id:"w1",tab_id:"w1:t1",label:"nvim",cwd:$cwd,foreground_cwd:$cwd,tokens:{nvim_session:$session}}]}}'
		;;
	"pane process-info")
		if [[ -e "$HERDR_PROCESS_STATE" ]]; then
			printf '{"result":{"process_info":{"foreground_processes":[{"name":"nvim"}]}}}\n'
		else
			printf '{"result":{"process_info":{"foreground_processes":[{"name":"fish"}]}}}\n'
		fi
		;;
	"pane report-metadata")
		if [[ "${3:-}" != "$PI_EXPECTED_HERDR_PANE_ID" || "${7:-}" != "nvim_session=$PI_EXPECTED_NVIM_SESSION" ]]; then
			printf 'Unexpected Herdr session report:' >&2
			printf ' %q' "$@" >&2
			printf '\n' >&2
			exit 1
		fi
		printf 'herdr-session-report\n' >>"$PI_RESTORE_ORDER_LOG"
		;;
	"pane run")
		if [[ "$#" -ne 4 || "$3" != "$PI_EXPECTED_HERDR_PANE_ID" ]]; then
			printf 'Unexpected Herdr pane run:' >&2
			printf ' %q' "$@" >&2
			printf '\n' >&2
			exit 1
		fi
		printf 'herdr-pane-run\n' >>"$PI_RESTORE_ORDER_LOG"
		printf '%s\n' "$4" >"$HERDR_COMMAND_CAPTURE"
		touch "$HERDR_PROCESS_STATE"
		cd "$HERDR_PANE_CWD"
		exec bash -c "$4"
		;;
	*)
		printf 'Unexpected Herdr fixture command:' >&2
		printf ' %q' "$@" >&2
		printf '\n' >&2
		exit 1
		;;
esac
HERDR
chmod +x "$fake_bin/herdr"

cat >"$fake_bin/nvim" <<'NVIM'
#!/usr/bin/env bash
set -euo pipefail
exec "$PI_REAL_NVIM" --headless -u NONE -i NONE -l "$PI_PRODUCTION_FIXTURE"
NVIM
chmod +x "$fake_bin/nvim"

cat >"$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
set -euo pipefail
: "${PI_ENVIRONMENT_CAPTURE:?}"
{
	printf 'HERDR_ENV=%s\n' "${HERDR_ENV:-}"
	printf 'HERDR_PANE_ID=%s\n' "${HERDR_PANE_ID:-}"
	printf 'HERDR_SOCKET_PATH=%s\n' "${HERDR_SOCKET_PATH:-}"
	printf 'PI_NVIM_HERDR_PANE_ID=%s\n' "${PI_NVIM_HERDR_PANE_ID:-}"
	printf 'PI_IMAGE_PROTOCOL=%s\n' "${PI_IMAGE_PROTOCOL:-}"
	printf 'PI_NVIM_LAUNCH_ID=%s\n' "${PI_NVIM_LAUNCH_ID:-}"
	printf 'PI_NVIM_SOCKET=%s\n' "${PI_NVIM_SOCKET:-}"
	index=0
	for argument in "$@"; do
		index=$((index + 1))
		printf 'ARG%d=%s\n' "$index" "$argument"
	done
} >"$PI_ENVIRONMENT_CAPTURE"
PI
chmod +x "$fake_bin/pi"

export PATH="$fake_bin:$PATH"
export HERDR_BIN_PATH="$fake_bin/herdr"
export HERDR_COMMAND_CAPTURE="$command_capture"
export HERDR_PROCESS_STATE="$process_state"
export HERDR_PANE_CWD="$repo_root"
export HERDR_SOCKET_PATH="$test_dir/herdr.sock"
export PI_EXPECTED_HERDR_PANE_ID="w1:p1"
export PI_EXPECTED_NVIM_SESSION="herdr-w1-p1"
export PI_ENVIRONMENT_CAPTURE="$pi_environment_capture"
export PI_MINI_SESSIONS_PATH="$mini_sessions_path"
export PI_PRODUCTION_FIXTURE="$repo_root/.config/nvim/tests/pi_production_session_restore.lua"
export PI_PRODUCTION_TEST_ROOT="$test_dir"
export PI_REAL_NVIM="$real_nvim"
export PI_RESTORE_ORDER_LOG="$order_log"
export REPO_ROOT="$repo_root"
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_STATE_HOME="$test_dir/state"
export XDG_CACHE_HOME="$test_dir/cache"
unset GIT_COMMIT GIT_EDITOR HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID NVIM_SESSION NVIM_APPNAME

cd "$test_dir"
bash "$plugin_root/scripts/restore.sh"

printf -v expected_command \
	'HERDR_ENV=1 HERDR_PANE_ID=%q HERDR_SOCKET_PATH=%q NVIM_SESSION=%q HERDR_MINI_SESSION_RESTORE=1 exec nvim' \
	"$PI_EXPECTED_HERDR_PANE_ID" \
	"$HERDR_SOCKET_PATH" \
	"$PI_EXPECTED_NVIM_SESSION"
actual_command="$(<"$command_capture")"
if [[ "$actual_command" != "$expected_command" ]]; then
	printf 'Unexpected Herdr Neovim restore command.\nExpected: %s\nActual:   %s\n' \
		"$expected_command" \
		"$actual_command" >&2
	exit 1
fi

expected_order=$'herdr-session-report\nherdr-pane-run\nneovim-started\npi-handler-before-mini-setup\nsession-workflow-setup\nnvim-vimenter\nnvim-herdr-pane-rename\nnvim-herdr-session-report\nnvim-session-read\nnvim-session-loaded\npi-exact-resume'
actual_order="$(<"$order_log")"
if [[ "$actual_order" != "$expected_order" ]]; then
	printf 'Unexpected production restoration order.\nExpected:\n%s\nActual:\n%s\n' \
		"$expected_order" \
		"$actual_order" >&2
	exit 1
fi
