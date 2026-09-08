#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
hypr_dir="$repo_root/.config/hypr"
test_dir="$(mktemp -d)"
monitor_pid=""
cleanup() {
  if [[ -n "$monitor_pid" ]] && kill -0 "$monitor_pid" 2>/dev/null; then
    kill "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

home="$test_dir/home"
runtime="$test_dir/run"
config="$home/.config/hypr"
bin="$test_dir/bin"
signature="waybar-acceptance"
instance="$runtime/hypr/$signature"
mkdir -p "$config/runtime/desktop" "$instance" "$bin"
ln -s "$hypr_dir/lib" "$config/lib"
ln -s "$hypr_dir/gaming" "$config/gaming"
ln -s "$hypr_dir/runtime/lib" "$config/runtime/lib"
ln -s "$hypr_dir/runtime/desktop/waybar-monitor.lua" "$config/runtime/desktop/waybar-monitor.lua"
ln -s "$hypr_dir/runtime/desktop/waybar-workers.lua" "$config/runtime/desktop/waybar-workers.lua"

cat > "$config/runtime/desktop/waybar-process.sh" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  running) exit 1 ;;
  replace-unit)
    printf '%s\n' "$$" > "$WAYBAR_ACCEPTANCE_WORKER"
    trap '' TERM
    sleep 5
    printf 'launched\n' > "$WAYBAR_ACCEPTANCE_LAUNCHED"
    ;;
  signal) exit 0 ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$config/runtime/desktop/waybar-process.sh"

cat > "$bin/hyprctl" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod +x "$bin/hyprctl"

export WAYBAR_ACCEPTANCE_WORKER="$test_dir/worker-pid"
export WAYBAR_ACCEPTANCE_LAUNCHED="$test_dir/launched"
HOME="$home" XDG_RUNTIME_DIR="$runtime" HYPRLAND_INSTANCE_SIGNATURE="$signature" PATH="$bin:$PATH" \
  luajit "$config/runtime/desktop/waybar-monitor.lua" >"$test_dir/monitor.log" 2>&1 &
monitor_pid=$!
socket="$instance/waybar-monitor.sock"
for _ in {1..50}; do
  if [[ -S "$socket" ]] && [[ "$(printf 'ping\n' | timeout 0.1 nc -w 1 -U "$socket" 2>/dev/null || true)" == ok ]]; then
    break
  fi
  sleep 0.02
done
[[ -S "$socket" ]] || { cat "$test_dir/monitor.log" >&2; exit 1; }

control() {
  local intent="$1" start elapsed
  start="$(date +%s%3N)"
  HOME="$home" XDG_RUNTIME_DIR="$runtime" HYPRLAND_INSTANCE_SIGNATURE="$signature" PATH="$bin:$PATH" \
    "$hypr_dir/runtime/desktop/waybar-control.sh" "$intent"
  elapsed=$(( $(date +%s%3N) - start ))
  (( elapsed < 500 )) || { printf '%s acknowledgement took %dms\n' "$intent" "$elapsed" >&2; exit 1; }
}

control show
for _ in {1..50}; do
  [[ -f "$WAYBAR_ACCEPTANCE_WORKER" ]] && break
  sleep 0.01
done
[[ -f "$WAYBAR_ACCEPTANCE_WORKER" ]]
control hide
control release
[[ ! -e "$WAYBAR_ACCEPTANCE_LAUNCHED" ]]

[[ "$(printf 'quit\n' | timeout 1 nc -w 1 -U "$socket")" == ok ]]
wait "$monitor_pid"
monitor_pid=""
sleep 0.05
[[ ! -e "$WAYBAR_ACCEPTANCE_LAUNCHED" ]]
if pgrep -f "$test_dir" >/dev/null; then
  printf 'Waybar monitor left a worker process running after quit\n' >&2
  exit 1
fi

rm -f "$WAYBAR_ACCEPTANCE_WORKER" "$WAYBAR_ACCEPTANCE_LAUNCHED"
HOME="$home" XDG_RUNTIME_DIR="$runtime" HYPRLAND_INSTANCE_SIGNATURE="$signature" PATH="$bin:$PATH" \
  luajit "$config/runtime/desktop/waybar-monitor.lua" >"$test_dir/restarted-monitor.log" 2>&1 &
monitor_pid=$!
for _ in {1..50}; do
  if [[ -S "$socket" ]] && [[ "$(printf 'ping\n' | timeout 0.1 nc -w 1 -U "$socket" 2>/dev/null || true)" == ok ]]; then
    break
  fi
  sleep 0.02
done
for _ in {1..50}; do
  [[ -f "$WAYBAR_ACCEPTANCE_WORKER" ]] && break
  sleep 0.01
done
[[ -f "$WAYBAR_ACCEPTANCE_WORKER" ]]
[[ "$(printf 'restart\n' | timeout 1 nc -w 1 -U "$socket")" == ok ]]
set +e
wait "$monitor_pid"
restart_status=$?
set -e
monitor_pid=""
[[ "$restart_status" -eq 75 ]]
sleep 0.05
[[ ! -e "$WAYBAR_ACCEPTANCE_LAUNCHED" ]]
if pgrep -f "$test_dir" >/dev/null; then
  printf 'Waybar monitor left a worker process running after restart\n' >&2
  exit 1
fi

printf 'PASS Waybar monitor acknowledges intents before effects and cancels workers on quit/restart\n'
