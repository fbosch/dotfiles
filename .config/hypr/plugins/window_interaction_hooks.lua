local async = require("lib.async")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local M = {}

local valid_kinds = {
	move = true,
	resize = true,
}
local control_socket = "nc -U "
	.. command.arg(hypr_ipc.instance_socket_path("window-state.sock"))
	.. " >/dev/null 2>&1"

local function notify_daemon(message)
	hl.dispatch(hl.dsp.exec_cmd("printf '%s\\n' " .. command.arg(message) .. " | " .. control_socket))
end

M.notify_daemon = notify_daemon

local plugin_path = os.getenv("HYPR_WINDOW_INTERACTION_HOOKS_PLUGIN")
if not plugin_path or plugin_path == "" then
	M.error = "window-interaction-hooks is unavailable; window-state persistence uses polling fallback"
	return M
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
	pcall(function()
		hl.plugin.window_interaction_hooks.rebind()
	end)

	hl.on("window_interaction_hooks.finished", function(window, kind)
		if not window or not valid_kinds[kind] then
			return
		end

		notify_daemon("interaction-finished " .. kind)
	end)

	local function announce_ready()
		notify_daemon("interaction-hooks-ready")
	end

	announce_ready()
	hl.on("hyprland.start", function()
		async.defer(announce_ready, 1000)
	end)
end)

if not ok then
	M.error = "window-interaction-hooks failed to load; window-state persistence uses polling fallback: "
		.. tostring(err)
	io.stderr:write(M.error, "\n")
end

return M
