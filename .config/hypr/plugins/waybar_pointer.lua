local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local plugin_path = os.getenv("HYPR_WAYBAR_POINTER_PLUGIN")
if not plugin_path or plugin_path == "" then
	return
end

local zones = { show = true, neutral = true, hide = true }
local control_socket = "nc -U "
	.. command.arg(hypr_ipc.instance_socket_path("waybar-monitor.sock"))
	.. " >/dev/null 2>&1"

local function forward_zone(zone)
	if zones[zone] ~= true then
		return
	end

	local message = "pointer-zone " .. zone
	hl.dispatch(hl.dsp.exec_cmd("printf '%s\\n' " .. command.arg(message) .. " | " .. control_socket))
end

local ok, err = pcall(function()
	hl.plugin.load(plugin_path)
	pcall(function()
		hl.plugin.waybar_pointer.rebind()
	end)

	hl.on("waybar_pointer.zone", function(zone)
		forward_zone(zone)
	end)

	hl.plugin.waybar_pointer.start(20, 60)
end)

if not ok then
	io.stderr:write("waybar-pointer: plugin load failed; automatic Waybar edge positioning is disabled: ", tostring(err), "\n")
end
