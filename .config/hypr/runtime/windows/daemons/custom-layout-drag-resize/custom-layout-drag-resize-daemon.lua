#!/usr/bin/env lua

local socket = require("socket")
local unix = require("socket.unix")
local hypr_ipc = dofile(os.getenv("HOME") .. "/.config/hypr/runtime/lib/hypr-ipc.lua")

local runtime_dir = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-custom-layout-drag-resize"
local command_socket_path = runtime_dir .. "/command.sock"
local state_file = runtime_dir .. "/state"
local pid_file = runtime_dir .. "/daemon.pid"
local drag_numerator = 1
local drag_denominator = 1
local monitors_by_id = {}
local drag_active = false

local hypr_socket = hypr_ipc.socket_path(".socket.sock")

local function request(message)
	return hypr_ipc.request(message, { path = hypr_socket, timeout = 0.2 })
end

local function json_number(text, key)
	local value = text:match('"' .. key .. '"%s*:%s*(-?%d+%.?%d*)')
	return value and tonumber(value) or nil
end

local function json_string(text, key)
	return text:match('"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function active_monitor_info()
	monitors_by_id = {}
	local monitors = request("j/monitors")
	for object in monitors:gmatch("%b{}") do
		local id = json_number(object, "id")
		if id then
			local name = json_string(object, "name")
			local refresh = json_number(object, "refreshRate") or 60
			monitors_by_id[id] = {
				name = name,
				poll_interval = math.max(0.003, math.min(0.010, 0.25 / refresh)),
			}
		end
	end
	return monitors_by_id
end

local function monitor_info(monitor_id)
	if not monitors_by_id[monitor_id] then
		active_monitor_info()
	end

	return monitors_by_id[monitor_id]
end

local function active_window_info()
	local active = request("j/activewindow")
	local monitor_id = json_number(active, "monitor")
	local x, y = active:match('"at"%s*:%s*%[%s*(-?%d+)%s*,%s*(-?%d+)%s*%]')
	local width, height = active:match('"size"%s*:%s*%[%s*(%d+)%s*,%s*(%d+)%s*%]')
	if not monitor_id or not x or not y or not width or not height then
		return nil
	end

	return {
		monitor_id = monitor_id,
		x = tonumber(x),
		y = tonumber(y),
		width = tonumber(width),
		height = tonumber(height),
	}
end

local function cursor_axis(axis)
	local response = request("j/cursorpos")
	local value = json_number(response, axis)
	if not value then
		error("cursor response missing " .. axis)
	end

	return value
end

local function dispatch(command, edge, position)
	request(string.format('dispatch hl.dsp.layout("%s %s %d")', command, edge, position))
end

local function write_file(path, value)
	local handle = assert(io.open(path, "w"))
	handle:write(value)
	handle:close()
end

local function resize_edge(axis, cursor, x, y, width, height)
	if axis == "x" then
		return cursor < x + width / 2 and "left" or "right"
	end

	return cursor < y + height / 2 and "up" or "down"
end

local function scaled_position(initial, current)
	local delta = (current - initial) * drag_numerator / drag_denominator
	if delta >= 0 then
		return initial + math.floor(delta)
	end

	return initial + math.ceil(delta)
end

local function stop_drag()
	drag_active = false
	os.remove(state_file)
end

local command_server = nil

local function read_command(client)
	client:settimeout(0.01)
	local line = client:receive("*l")
	client:close()
	return line
end

local function accept_command(timeout)
	if not command_server then
		return nil
	end

	command_server:settimeout(timeout or 0)
	local client = command_server:accept()
	if not client then
		return nil
	end

	return read_command(client)
end

local function handle_command(command)
	if command == "stop" then
		stop_drag()
		return true
	end

	return command == "quit"
end

local function start_drag()
	stop_drag()

	local active = active_window_info()
	if not active then
		return
	end

	local monitor = monitor_info(active.monitor_id)
	local monitor_name = monitor and monitor.name or nil
	local poll_interval = monitor and monitor.poll_interval or 0.008
	local axis, command
	if monitor_name == "DP-2" then
		axis = "x"
		command = "resize-x-at"
	elseif monitor_name == "HDMI-A-2" then
		axis = "y"
		command = "resize-y-at"
	else
		request("dispatch hl.dsp.window.resize()")
		return
	end

	local initial = cursor_axis(axis)
	local edge = resize_edge(axis, initial, active.x, active.y, active.width, active.height)
	drag_active = true
	write_file(state_file, "active\n")

	local last_sent = nil

	for _ = 1, 1200 do
		if handle_command(accept_command(0)) then
			break
		end

		if not drag_active then
			break
		end

		local ok, current = pcall(cursor_axis, axis)
		if ok then
			local scaled = scaled_position(initial, current)
			if scaled ~= last_sent then
				local dispatched = pcall(dispatch, command, edge, scaled)
				if dispatched then
					last_sent = scaled
				end
			end
		end

		socket.sleep(poll_interval)
	end

	stop_drag()
end

local function ensure_command_socket()
	os.execute(string.format("mkdir -p %q", runtime_dir))
	os.remove(command_socket_path)
	command_server = assert(unix())
	assert(command_server:bind(command_socket_path))
	assert(command_server:listen())
	command_server:settimeout(0)
	write_file(pid_file, tostring(os.getenv("HYPRLAND_INSTANCE_SIGNATURE") or "") .. "\n")
end

local function run()
	ensure_command_socket()
	pcall(active_monitor_info)

	while true do
		local line = accept_command(0.1)
		if line == "start" then
			pcall(start_drag)
		elseif line == "ping" then
			-- Health check for the shell wrapper's singleton guard.
		elseif line == "stop" then
			stop_drag()
		elseif line == "quit" then
			break
		end
	end

	if command_server then
		command_server:close()
	end
	os.remove(command_socket_path)
	os.remove(pid_file)
end

run()
