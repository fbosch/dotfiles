-- Lua-native equivalent of scripts/killactive-selective.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local system = require("lua.lib.system")

local M = {}

local home = os.getenv("HOME")
local profilectl = home .. "/.config/hypr/scripts/profilectl.sh"
local minimize_script = home .. "/.config/hypr/scripts/toggle-minimized-window.sh"

local function command_ok(command)
  local ok, _, code = os.execute(command)
  return ok == true or ok == 0 or code == 0
end

local function is_gaming_active()
  return command_ok(system.shell_quote(profilectl) .. " is-active gaming >/dev/null 2>&1")
end

local function is_gaming_protected_window(app_class)
  return app_class == "gamescope" or app_class:match("^steam_app_.*$") ~= nil
end

local function is_steam_window(app_class)
  return app_class == "Steam" or app_class == "steam"
end

local function active_window()
  if hl.get_active_window then
    return hl.get_active_window()
  end

  for _, window in ipairs(hl.get_windows()) do
    if window.active then
      return window
    end
  end

  return nil
end

local function notify(summary, body)
  hl.exec_cmd(
    "notify-send -a Hyprland "
      .. system.shell_quote(summary)
      .. " "
      .. system.shell_quote(body)
  )
end

function M.close_active_selective()
  local window = active_window()
  local app_class = window and ((window.class ~= "" and window.class) or window.initial_class or "") or ""
  local title = window and (window.title or "") or ""

  if is_gaming_active() and is_gaming_protected_window(app_class) then
    notify("Kill blocked", "Gamemoded window protected: " .. title)
    return
  end

  if is_steam_window(app_class) then
    hl.exec_cmd(system.shell_quote(minimize_script))
    return
  end

  hl.dispatch(hl.dsp.window.close())
end

return M
