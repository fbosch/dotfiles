local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local M = {}

local control_socket = command.arg(hypr_ipc.instance_socket_path("waybar-monitor.sock"))
local process_pattern = command.arg("(^|/)waybar( |$)")

local function control(message, fallback)
	local command_line = "printf "
		.. command.arg(message .. "\\n")
		.. " | nc -U "
		.. control_socket
		.. " >/dev/null 2>&1"
	return hl.dsp.exec_cmd(command_line .. (fallback and (" || " .. fallback) or " || true"))
end

-- hold shows waybar even when the monitor daemon is down, via waybar's own SIGUSR1.
M.hold = control("hold", "pkill -SIGUSR1 -f " .. process_pattern)
M.release = control("release")

return M
