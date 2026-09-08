#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
hypr_dir="$repo_root/.config/hypr"
if grep -Fq 'session("waybar")' "$hypr_dir/autostart.lua"; then
  printf 'Hyprland autostart still launches Waybar eagerly\n' >&2
  exit 1
fi
grep -Fq '"start_hidden": true' "$repo_root/.config/waybar/config"
grep -Fq 'M.prewarm = control("prewarm")' "$hypr_dir/actions/waybar.lua"
grep -Fq 'desktop/waybar-control.sh' "$hypr_dir/actions/waybar.lua"
if grep -Fq 'desktop/waybar-monitor.sh' "$hypr_dir/actions/waybar.lua"; then
  printf 'Hyprland actions still use the private Waybar monitor launcher\n' >&2
  exit 1
fi
grep -Fq 'bind.register(main("SUPER_L"), waybar.prewarm)' "$hypr_dir/keybinds.lua"
grep -Fq 'window_switcher.commit()' "$hypr_dir/keybinds.lua"
grep -Fq 'hl.dispatch(waybar.release)' "$hypr_dir/keybinds.lua"
if grep -Fq 'release_super' "$hypr_dir/actions/window-switcher.lua"; then
  printf 'window switcher still owns Super release orchestration\n' >&2
  exit 1
fi
grep -Fq 'prewarm = prewarm_waybar' "$hypr_dir/runtime/desktop/waybar-monitor.lua"

if [[ ! -x "$hypr_dir/runtime/desktop/waybar-process.sh" || ! -x "$hypr_dir/runtime/desktop/waybar-control.sh" ]]; then
  printf 'Waybar runtime helpers must be executable\n' >&2
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

printf 'PASS Waybar clients route demand to the sole lazy launch owner\n'
