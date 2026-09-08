#!/usr/bin/env bash

set -euo pipefail

repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
hypr_dir="$repo_root/.config/hypr"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

home_dir="$test_dir/home"
bin_dir="$test_dir/bin"
runtime_dir="$test_dir/run"
mkdir -p "$home_dir/.config" "$bin_dir" "$runtime_dir"
ln -s "$hypr_dir" "$home_dir/.config/hypr"

cat > "$bin_dir/timeout" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" > "$WAYBAR_CLIENT_ARGS"
cat > "$WAYBAR_CLIENT_BODY"
printf 'ok\n'
EOF
chmod +x "$bin_dir/timeout"

export WAYBAR_CLIENT_ARGS="$test_dir/client-args"
export WAYBAR_CLIENT_BODY="$test_dir/client-body"
HOME="$home_dir" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE="fixture-instance" \
  "$hypr_dir/runtime/desktop/waybar-monitor.sh" show

[[ "$(cat "$WAYBAR_CLIENT_BODY")" == "show" ]]
grep -Fq "nc -w 1 -U $runtime_dir/hypr/fixture-instance/waybar-monitor.sock" "$WAYBAR_CLIENT_ARGS"

set +e
invalid_output="$(HOME="$home_dir" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE="fixture-instance" \
  "$hypr_dir/runtime/desktop/waybar-monitor.sh" show extra 2>&1)"
invalid_status=$?
set -e
if [[ "$invalid_status" -ne 2 || "$invalid_output" != *"usage:"* ]]; then
  printf 'waybar monitor client accepted invalid arguments\n' >&2
  exit 1
fi

if grep -Fq 'session("waybar")' "$hypr_dir/autostart.lua"; then
  printf 'Hyprland autostart still launches Waybar eagerly\n' >&2
  exit 1
fi
grep -Fq '"start_hidden": true' "$repo_root/.config/waybar/config"

if [[ ! -x "$hypr_dir/runtime/desktop/waybar-process.sh" ]]; then
  printf 'Waybar process helper must be executable\n' >&2
  exit 1
fi
HYPRLAND_INSTANCE_SIGNATURE="fixture-instance" \
  "$hypr_dir/runtime/desktop/waybar-process.sh" unit-name \
  | grep -Fxq 'app-Hyprland-waybar-demand-fixture-instance.service'

launch_owners="$(grep -R -l -F 'uwsm-app -s s -t service -u' "$hypr_dir/runtime" || true)"
if [[ "$launch_owners" != "$hypr_dir/runtime/desktop/waybar-monitor.lua" ]]; then
  printf 'Waybar launch ownership is not exclusive to waybar-monitor.lua:\n%s\n' "$launch_owners" >&2
  exit 1
fi
grep -Fq "app-Hyprland-waybar-demand-\${signature}.service" \
  "$hypr_dir/runtime/desktop/waybar-process.sh"
if grep -R -Fq 'uwsm-app -s s -- waybar' "$hypr_dir/runtime"; then
  printf 'Waybar still has an unnamed scope launch path\n' >&2
  exit 1
fi

if grep -R -Fq 'pkill -SIGUSR1 -f' \
  "$repo_root/.config/ags/components/audio-mixer" \
  "$repo_root/.config/ags/components/calendar" \
  "$repo_root/.config/ags/components/start-menu"; then
  printf 'an AGS component still signals Waybar directly\n' >&2
  exit 1
fi
for controller in audio-mixer calendar start-menu; do
  grep -Fq '@/services/waybar-control' "$repo_root/.config/ags/components/$controller/controller.ts"
done
grep -Fq 'desktop/waybar-monitor.sh' "$hypr_dir/actions/waybar.lua"

printf 'PASS Waybar clients route demand to the sole lazy launch owner\n'
