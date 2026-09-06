#!/usr/bin/env bash

set -euo pipefail

hypr_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ags_start="$hypr_dir/../ags/start-daemons.sh"
hypr_config="$hypr_dir/hyprland.lua"
reset_desktop="$hypr_dir/runtime/desktop/reset-desktop.sh"

if grep -Eq 'profilectl|PROFILECTL|[[:space:]]reconcile([[:space:]]|$)' "$ags_start"; then
  printf 'AGS startup must not reconcile Hyprland profile state\n' >&2
  exit 1
fi

grep -Eq 'profilectl\.sh reconcile \|\| true' "$reset_desktop"

HYPR_CONFIG="$hypr_config" HOME="$hypr_dir/tests/fixture-home" luajit - <<'LUA'
local apply_count = 0

package.preload["rule_loader"] = function()
  return {
    apply_window_rule_phase = function()
      return {}
    end,
    report_results = function() end,
  }
end

for _, module in ipairs({
  "base",
  "plugins",
  "programs",
  "monitors",
  "layouts.ultrawide_master",
  "layouts.portrait_rows",
  "rules.workspace",
  "keybinds",
  "animations",
  "rules",
  "environment",
  "appearance",
  "rules.layer",
  "input",
  "autostart",
}) do
  package.preload[module] = function()
    return {}
  end
end

package.preload["runtime.windows.minimized-state"] = function()
  return { register_lifecycle = function() end }
end

package.preload["profiles"] = function()
  return {
    apply_current = function()
      apply_count = apply_count + 1
    end,
  }
end

local config = assert(os.getenv("HYPR_CONFIG"))
dofile(config)
dofile(config)
assert(apply_count == 2, "profile overlay was not reapplied on each config load")
LUA

printf 'PASS profile lifecycle keeps AGS startup independent and reapplies overlays during config loading\n'
