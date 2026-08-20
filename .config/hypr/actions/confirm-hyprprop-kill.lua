local ags = require("lib.ags")
local command = require("lib.command")
local notify = require("lib.notify")

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

local function confirm_payload(pid)
	return {
		action = "show",
		config = {
			icon = "󱂥",
			title = "Force close window",
			message = "Kill selected process [PID: " .. pid .. "]?",
			confirmLabel = "Kill",
			cancelLabel = "Cancel",
			operation = { type = "kill-process", pid = tonumber(pid) },
			variant = "danger",
		},
	}
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

	ags.request("confirm-dialog", confirm_payload(pid))
end

return M
