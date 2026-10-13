local async = require("lib.async")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local M = { enabled = false }

local pip_socket = "nc -U " .. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock")) .. " >/dev/null 2>&1"

local function notify(socket_command, message)
	hl.dispatch(hl.dsp.exec_cmd("printf '%s\\n' " .. command.arg(message) .. " | " .. socket_command))
end

local function native_api()
	return hl.plugin and hl.plugin.window_interaction_hooks
end

local function target_handle(window, epoch)
	if window == nil then
		return nil
	end
	assert(type(epoch) == "string", "window-interaction-hooks returned a target without an epoch")
	return {
		window = window,
		epoch = epoch,
		resolve = function(self)
			local api = native_api()
			if not api or type(api.resolve_target) ~= "function" then
				return nil
			end
			return api.resolve_target(self.window, self.epoch)
		end,
	}
end

function M.capture_at_cursor()
	if not M.enabled then
		return nil
	end
	local api = native_api()
	if not api or type(api.capture_at_cursor) ~= "function" then
		return nil
	end
	return target_handle(api.capture_at_cursor())
end

function M.capture_window(window)
	if not M.enabled or window == nil then
		return nil
	end
	local api = native_api()
	if not api or type(api.capture_window) ~= "function" then
		return nil
	end
	return target_handle(api.capture_window(window))
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

	local api = native_api()
	local target_api_available = api
		and type(api.supports_target_handles) == "function"
		and type(api.capture_at_cursor) == "function"
		and type(api.capture_window) == "function"
		and type(api.resolve_target) == "function"
	local supports_targets_ok, supported_targets = false, false
	if target_api_available then
		supports_targets_ok, supported_targets = pcall(api.supports_target_handles)
	end
	M.enabled = target_api_available == true and supports_targets_ok == true and supported_targets == true
	if not M.enabled then
		M.error = "window-interaction-hooks lacks native target-handle API; pointer interactions disabled"
		io.stderr:write(M.error, "\n")
	end

	hl.on("window_interaction_hooks.dropped", function(window, workspace, x, y)
		require("lib.window.custom_layout").request_drop(window, workspace, x, y)
	end)

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
	M.enabled = false
	M.error = "window-interaction-hooks failed to load; PiP previews use polling fallback: " .. tostring(err)
	io.stderr:write(M.error, "\n")
end

return M
