-- Lua-native equivalent of scripts/killactive-selective.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local command = require("lib.command")
local notify = require("lib.notify")
local paths = require("lib.paths")
local window = require("lib.window")

local M = {}

local profilectl = paths.runtime_script("profiles/profilectl.sh")
local minimize_script = paths.runtime_script("windows/toggle-minimized-window.sh")

local function is_gaming_active()
  return command.ok(command.line(profilectl, "is-active", "gaming") .. " >/dev/null 2>&1")
end

local function is_gaming_protected_window(app_class)
  return app_class == "gamescope" or app_class:match("^steam_app_.*$") ~= nil
end

local function is_steam_window(app_class)
  return app_class == "Steam" or app_class == "steam"
end

function M.close_active_selective()
  local active = window.active()
  local app_class = active and ((active.class ~= "" and active.class) or active.initial_class or "") or ""
  local title = active and (active.title or "") or ""

  if is_gaming_active() and is_gaming_protected_window(app_class) then
    notify.send({ summary = "Kill blocked", body = "Gamemoded window protected: " .. title })
    return
  end

  if is_steam_window(app_class) then
    hl.exec_cmd(command.arg(minimize_script))
    return
  end

  hl.dispatch(hl.dsp.window.close())
end

return M
