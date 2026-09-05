#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
test_dir="$(mktemp -d)"
wrapper_pid=""
cleanup() {
  if [[ -n "$wrapper_pid" ]]; then
    kill -TERM "$wrapper_pid" >/dev/null 2>&1 || true
    wait "$wrapper_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_dir"
}
trap cleanup EXIT

export HOME="$test_dir/home"
export XDG_RUNTIME_DIR="$test_dir/runtime"
export HYPRLAND_INSTANCE_SIGNATURE=instance-a
# Keep the pre-change implementation confined while proving this override is ignored.
export HYPR_WINDOW_CAPTURE_DIR="$test_dir/legacy"
export GRIM_CONTENT="instance-a"
mkdir -p "$HOME/.config" "$XDG_RUNTIME_DIR" "$test_dir/bin" "$HYPR_WINDOW_CAPTURE_DIR"
ln -s "$repo_root" "$HOME/.config/hypr"
export PATH="$test_dir/bin:$PATH"

cat > "$test_dir/bin/hyprctl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'clients -j'|*'activewindow -j')
    printf '%s\n' '[{"address":"0xabc","stableId":"shared-preview","mapped":true,"size":[100,100],"workspace":{"id":1}}]'
    ;;
  *'monitors -j') printf '%s\n' '[{"activeWorkspace":{"id":1}}]' ;;
  *) exit 1 ;;
esac
SH
cat > "$test_dir/bin/grim" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$GRIM_CONTENT" > "${!#}"
SH
chmod +x "$test_dir/bin/hyprctl" "$test_dir/bin/grim"

daemon="$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.lua"
wrapper="$repo_root/runtime/windows/daemons/window-capture/window-capture-daemon.sh"
instance_a="$XDG_RUNTIME_DIR/hypr/instance-a/window-captures"
instance_b="$XDG_RUNTIME_DIR/hypr/instance-b/window-captures"

capture() {
  HYPRLAND_INSTANCE_SIGNATURE="$1" luajit "$daemon" handle-event 'openwindow>>0xabc,1,fixture,Window'
}

capture instance-a
if [[ ! -s "$instance_a/shared-preview.jpg" ]]; then
  printf 'FAIL preview was not published in its instance directory\n' >&2
  exit 1
fi
test "$(<"$instance_a/shared-preview.jpg")" = instance-a
test -z "$(find "$HYPR_WINDOW_CAPTURE_DIR" -mindepth 1 -print -quit)"

# The same client identifier in another compositor is a different preview.
GRIM_CONTENT=instance-b capture instance-b
test "$(<"$instance_b/shared-preview.jpg")" = instance-b
test "$(<"$instance_a/shared-preview.jpg")" = instance-a

# Capture, cleanup, and coordination in A must leave every B file untouched.
printf 'stale-a\n' > "$instance_a/stale.jpg"
printf 'b-only\n' > "$instance_b/b-only.jpg"
for marker in .pending_event .capture_lock .workspace_change .last_event .last_healthcheck; do
  printf 'owned-by-b\n' > "$instance_b/$marker"
done
before_b="$(find "$instance_b" -type f -exec sha256sum {} + | sort)"
HYPRLAND_INSTANCE_SIGNATURE=instance-a luajit "$daemon" refresh-once
test ! -e "$instance_a/stale.jpg"
test "$(find "$instance_b" -type f -exec sha256sum {} + | sort)" = "$before_b"
test "$(<"$instance_a/shared-preview.jpg")" = instance-a

wait_for_daemon() {
  for _ in {1..100}; do
    [[ -s "$XDG_RUNTIME_DIR/hypr/instance-a/window-capture-daemon.lock.d/pid" ]] && return 0
    kill -0 "$wrapper_pid" >/dev/null 2>&1 || break
    sleep 0.02
  done
  printf 'capture daemon did not start\n' >&2
  return 1
}

# Starting and stopping real helpers must not rewrite or remove accepted JPEGs.
preview_before="$(stat -c '%i %s %y' "$instance_a/shared-preview.jpg")"
for _ in 1 2; do
  HYPRLAND_INSTANCE_SIGNATURE=instance-a "$wrapper" > "$test_dir/daemon.log" 2>&1 &
  wrapper_pid="$!"
  wait_for_daemon
  test "$(stat -c '%i %s %y' "$instance_a/shared-preview.jpg")" = "$preview_before"
  kill -TERM "$wrapper_pid"
  wait "$wrapper_pid"
  wrapper_pid=""
  test -s "$instance_a/shared-preview.jpg"
  test "$(stat -c '%i %s %y' "$instance_a/shared-preview.jpg")" = "$preview_before"
done

# A new compositor starts empty, and an absent identity must never select a global root.
HYPRLAND_INSTANCE_SIGNATURE=instance-c luajit "$daemon" worker
test -d "$XDG_RUNTIME_DIR/hypr/instance-c/window-captures"
test ! -e "$XDG_RUNTIME_DIR/hypr/instance-c/window-captures/shared-preview.jpg"
for variable in XDG_RUNTIME_DIR HYPRLAND_INSTANCE_SIGNATURE; do
  if env -u "$variable" luajit "$daemon" worker > "$test_dir/missing.log" 2>&1; then
    printf 'capture accepted missing %s\n' "$variable" >&2
    exit 1
  fi
  if env "$variable=" luajit "$daemon" worker > "$test_dir/empty.log" 2>&1; then
    printf 'capture accepted empty %s\n' "$variable" >&2
    exit 1
  fi
done
test -z "$(find "$HYPR_WINDOW_CAPTURE_DIR" -mindepth 1 -print -quit)"

printf 'PASS window previews isolate instances and survive helper restarts\n'
