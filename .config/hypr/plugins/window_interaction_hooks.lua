local async = require("lib.async")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local M = {}

local pip_socket = "nc -U " .. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock")) .. " >/dev/null 2>&1"

local function notify(socket_command, message)
	hl.dispatch(hl.dsp.exec_cmd("printf '%s\\n' " .. command.arg(message) .. " | " .. socket_command))
end

local plugin_path = os.getenv("HYPR_WINDOW_INTERACTION_HOOKS_PLUGIN")
if not plugin_path or plugin_path == "" then
	M.error = "window-interaction-hooks is unavailable; PiP previews use polling fallback"
	return M
end

local updates_supported = false
local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
	pcall(function()
		hl.plugin.window_interaction_hooks.rebind()
	end)
	local supports_ok, supported = pcall(function()
		return hl.plugin.window_interaction_hooks.supports_updates()
	end)
	updates_supported = supports_ok and supported == true

	local function announce_ready()
		if updates_supported then
			notify(pip_socket, "interaction-updates-ready")
		end
	end

	announce_ready()
	hl.on("hyprland.start", function()
		async.defer(announce_ready, 1000)
	end)
end)

if not ok then
	M.error = "window-interaction-hooks failed to load; PiP previews use polling fallback: " .. tostring(err)
	io.stderr:write(M.error, "\n")
end

return M
