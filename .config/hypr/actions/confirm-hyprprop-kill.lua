-- Lua-native equivalent of scripts/confirm-hyprprop-kill.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local ags = require("lib.ags")
local command = require("lib.command")
local json = require("lib.json")
local notify = require("lib.notify")
local paths = require("lib.paths")

local M = {}

local function field(expression)
	return command.output_line("hyprprop --raw 2>/dev/null | jq -r " .. command.arg(expression) .. " 2>/dev/null")
end

local function numeric_pid(value)
	return value:match("^[1-9][0-9]*$") ~= nil
end

local function notify_failed(body)
	notify.send({ summary = "hyprprop kill", body = body })
end

local function confirm_payload(pid, display_name)
	return json.encode({
		action = "show",
		config = {
			icon = "󱂥",
			title = "Force close window",
			message = "Kill process: " .. display_name .. " [PID: " .. pid .. "]?",
			confirmLabel = "Kill",
			cancelLabel = "Cancel",
			confirmCommand = paths.script("kill-pid-with-fallback.sh") .. " " .. pid,
			variant = "danger",
		},
	})
end

function M.confirm_hyprprop_kill()
	if not command.ok("command -v hyprprop >/dev/null 2>&1") then
		notify_failed("hyprprop not found")
		return
	end

	local pid = field(".pid // empty")
	if not numeric_pid(pid) then
		notify_failed("Could not determine PID")
		return
	end

	local title = field(".title // \"\"")
	local app_class = field(".class // .initialClass // \"Unknown\"")
	local display_name = app_class
	if title ~= "" then
		display_name = app_class .. " (" .. title .. ")"
	end

	ags.request("confirm-dialog", confirm_payload(pid, display_name))
end

return M
