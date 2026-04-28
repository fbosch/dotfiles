-- Lua-native equivalent of scripts/confirm-exit.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local system = require("lua.lib.system")

local M = {}

local home = os.getenv("HOME")

local function confirm_payload()
	return [[{
  "action": "show",
  "config": {
    "icon": "󰿅",
    "title": "Exit Hyprland",
    "message": "This will end your Wayland session",
    "confirmLabel": "Exit",
    "cancelLabel": "Cancel",
    "confirmCommand": "]] .. home .. [[/.config/hypr/scripts/exit-session.sh",
    "variant": "danger",
    "audioFile": "]] .. home .. [[/.config/hypr/assets/warn.ogg",
    "showDelay": 180
  }
}]]
end

function M.confirm_exit()
	hl.exec_cmd("ags request -i ags-bundled confirm-dialog " .. system.shell_quote(confirm_payload()))
end

return M
