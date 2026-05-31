#!/usr/bin/env lua

local socket = require("socket")
local unix = require("socket.unix")

local script = os.getenv("HOME") .. "/.config/hypr/runtime/windows/window-capture-daemon.sh"

local function socket_path()
	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or not signature then
		error("missing Hyprland socket environment")
	end

	return runtime_dir .. "/hypr/" .. signature .. "/.socket2.sock"
end

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function connect_events()
	local client = assert(unix())
	client:settimeout(0.5)
	assert(client:connect(socket_path()))
	client:settimeout(nil)
	return client
end

local function handle_event(line)
	os.execute(shell_quote(script) .. " handle-event " .. shell_quote(line) .. " >/dev/null 2>&1")
end

local function is_capture_event(line)
	return line:match("^activewindow")
		or line:match("^activewindowv2")
		or line:match("^workspace")
		or line:match("^workspacev2")
		or line:match("^openwindow")
		or line:match("^openwindowv2")
		or line:match("^movewindow")
		or line:match("^movewindowv2")
		or line:match("^changefloatingmode")
		or line:match("^fullscreen")
		or line:match("^fullscreenv2")
		or line:match("^closewindow")
end

while true do
	local client = connect_events()
	while true do
		local line, err, partial = client:receive("*l")
		line = line or partial
		if line and line ~= "" and is_capture_event(line) then
			handle_event(line)
		end
		if err == "closed" then
			client:close()
			break
		elseif err then
			client:close()
			socket.sleep(0.5)
			break
		end
	end
end
