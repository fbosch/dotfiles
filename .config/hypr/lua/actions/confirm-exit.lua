-- Lua-native equivalent of scripts/confirm-exit.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local ags = require("lua.lib.ags")
local paths = require("lua.lib.paths")

local M = {}

local function confirm_payload()
	return [[{
  "action": "show",
  "config": {
    "icon": "󰿅",
    "title": "Exit Hyprland",
    "message": "This will end your Wayland session",
    "confirmLabel": "Exit",
    "cancelLabel": "Cancel",
    "confirmCommand": "]] .. paths.script("exit-session.sh") .. [[",
    "variant": "danger",
    "audioFile": "]] .. paths.asset("warn.ogg") .. [[",
    "showDelay": 180
  }
}]]
end

function M.confirm_exit()
	ags.request("confirm-dialog", confirm_payload())
end

return M
