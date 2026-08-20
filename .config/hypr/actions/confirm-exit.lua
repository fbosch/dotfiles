local ags = require("lib.ags")

local M = {}
local payload = nil

local function confirm_payload()
	return {
		action = "show",
		config = {
			icon = "󰿅",
			title = "Exit Hyprland",
			message = "This will end your Wayland session",
			confirmLabel = "Exit",
			cancelLabel = "Cancel",
			operation = { type = "exit-session" },
			variant = "danger",
			playWarningSound = true,
			showDelay = 180,
		},
	}
end

function M.confirm_exit()
	payload = payload or confirm_payload()
	ags.request("confirm-dialog", payload)
end

return M
