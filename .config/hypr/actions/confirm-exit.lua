-- Lua-native equivalent of scripts/confirm-exit.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local ags = require("lib.ags")
local json = require("lib.json")
local paths = require("lib.paths")

local M = {}
local payload = nil

local function confirm_payload()
	return json.encode({
		action = "show",
		config = {
			icon = "󰿅",
			title = "Exit Hyprland",
			message = "This will end your Wayland session",
			confirmLabel = "Exit",
			cancelLabel = "Cancel",
			confirmCommand = paths.runtime_script("session/exit-session.sh"),
			variant = "danger",
			audioFile = paths.asset("warn.ogg"),
			showDelay = 180,
		},
	})
end

function M.confirm_exit()
	payload = payload or confirm_payload()
	ags.request("confirm-dialog", payload)
end

return M
