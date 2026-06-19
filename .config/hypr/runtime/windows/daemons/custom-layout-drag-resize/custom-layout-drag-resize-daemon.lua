#!/usr/bin/env lua

local socket = require("socket")
local unix = require("socket.unix")
local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local hypr_ipc = dofile(config_dir .. "/runtime/lib/hypr-ipc.lua")

local runtime_dir = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-custom-layout-drag-resize"
local command_socket_path = runtime_dir .. "/command.sock"
local state_file = runtime_dir .. "/state"
local pid_file = runtime_dir .. "/daemon.pid"
local profile_mode_file = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-profiles/profile-overlay.mode"
local min_floating_size = 64
local drag_numerator = 1
local drag_denominator = 1
local monitors_by_id = {}
local drag_active = false
local windows_move_animation = [[hl.animation({ leaf = "windowsMove", enabled = true, speed = 1.5, bezier = "quick" })]]

local hypr_socket = hypr_ipc.socket_path(".socket.sock")

local function request(message)
	return hypr_ipc.request(message, { path = hypr_socket, timeout = 0.2 })
end

local function eval(code)
	request("eval " .. code)
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return ""
	end

	local value = handle:read("*l") or ""
	handle:close()
	return value
end

local function restore_resize_animation()
	if read_file(profile_mode_file) ~= "" then
		eval([[require("profiles").apply_current()]])
		return
	end

	eval(windows_move_animation)
end

local function json_number(text, key)
	local value = text:match('"' .. key .. '"%s*:%s*(-?%d+%.?%d*)')
	return value and tonumber(value) or nil
end

local function json_string(text, key)
	return text:match('"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function query_json(message, fallback)
	local ok, value = pcall(json.decode, request(message))
	if ok then
		return value
	end

	return fallback
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
				poll_interval = math.max(0.006, math.min(0.017, 1 / refresh)),
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
	local address = json_string(active, "address")
	local monitor_id = json_number(active, "monitor")
	local floating = active:match('"floating"%s*:%s*true') ~= nil
	local x, y = active:match('"at"%s*:%s*%[%s*(-?%d+)%s*,%s*(-?%d+)%s*%]')
	local width, height = active:match('"size"%s*:%s*%[%s*(%d+)%s*,%s*(%d+)%s*%]')
	if not monitor_id or not x or not y or not width or not height then
		return nil
	end

	return {
		address = address,
		monitor_id = monitor_id,
		floating = floating,
		x = tonumber(x),
		y = tonumber(y),
		width = tonumber(width),
		height = tonumber(height),
	}
end

local cursor_position

local function client_window_info(client)
	local at = type(client.at) == "table" and client.at or {}
	local size = type(client.size) == "table" and client.size or {}
	if not client.monitor or not at[1] or not at[2] or not size[1] or not size[2] then
		return nil
	end

	return {
		address = client.address,
		monitor_id = client.monitor,
		floating = client.floating == true,
		x = at[1],
		y = at[2],
		width = size[1],
		height = size[2],
	}
end

local function client_contains_cursor(client, x, y)
	if client.mapped ~= true or client.hidden == true or client.visible ~= true or client.acceptsInput == false then
		return false
	end

	local info = client_window_info(client)
	if not info then
		return false
	end

	return x >= info.x and x < info.x + info.width and y >= info.y and y < info.y + info.height
end

local function preferred_hover_candidate(candidate, best)
	if not best then
		return true
	end

	if candidate.floating == true and best.floating ~= true then
		return true
	elseif candidate.floating ~= true and best.floating == true then
		return false
	end

	return (candidate.focusHistoryID or math.huge) < (best.focusHistoryID or math.huge)
end

local function hovered_window_info(x, y)
	local clients = query_json("j/clients", {})
	local best = nil
	for _, client in ipairs(clients) do
		if client_contains_cursor(client, x, y) and preferred_hover_candidate(client, best) then
			best = client
		end
	end

	return best and client_window_info(best) or nil
end

local function focus_window(address)
	if type(address) ~= "string" or not address:match("^0x%x+$") then
		return false
	end

	return pcall(request, string.format("dispatch hl.dsp.focus({ window = %q })", "address:" .. address))
end

local function target_window_info()
	local ok, x, y = pcall(cursor_position)
	if not ok then
		return active_window_info()
	end

	local hovered = hovered_window_info(x, y)
	if not hovered or not focus_window(hovered.address) then
		return active_window_info()
	end

	return hovered
end

local function cursor_axis(axis)
	local response = request("j/cursorpos")
	local value = json_number(response, axis)
	if not value then
		error("cursor response missing " .. axis)
	end

	return value
end

function cursor_position()
	local response = request("j/cursorpos")
	local x = json_number(response, "x")
	local y = json_number(response, "y")
	if not x or not y then
		error("cursor response missing position")
	end

	return x, y
end

local function dispatch(command, edge, position)
	request(string.format('dispatch hl.dsp.layout("%s %s %d")', command, edge, position))
end

local function dispatch_window_geometry(active, x, y, width, height)
	if width ~= active.width or height ~= active.height then
		request(string.format("dispatch hl.dsp.window.resize({ x = %d, y = %d })", width, height))
	end

	if x ~= active.x or y ~= active.y then
		request(string.format("dispatch hl.dsp.window.move({ x = %d, y = %d })", x, y))
	end
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

local function floating_axis(edge, origin, size, delta)
	if edge == "left" or edge == "up" then
		local next_size = math.max(min_floating_size, size - delta)
		return origin + size - next_size, next_size
	end

	return origin, math.max(min_floating_size, size + delta)
end

local accept_command
local handle_command

local function stop_drag()
	local was_active = drag_active or read_file(state_file) ~= ""
	drag_active = false
	os.remove(state_file)
	if was_active then
		restore_resize_animation()
	end
end

local function disable_resize_animation()
	eval([[hl.animation({ leaf = "windowsMove", enabled = false })]])
end

local function start_floating_drag(active, poll_interval)
	poll_interval = math.max(poll_interval, 1 / 60)
	local initial_x, initial_y = cursor_position()
	local edge_x = resize_edge("x", initial_x, active.x, active.y, active.width, active.height)
	local edge_y = resize_edge("y", initial_y, active.x, active.y, active.width, active.height)
	drag_active = true
	disable_resize_animation()
	write_file(state_file, "active\n")

	local last_geometry = nil

	for _ = 1, 1200 do
		if handle_command(accept_command(0)) then
			break
		end

		if not drag_active then
			break
		end

		local ok, current_x, current_y = pcall(cursor_position)
		if ok then
			local x, width = floating_axis(edge_x, active.x, active.width, current_x - initial_x)
			local y, height = floating_axis(edge_y, active.y, active.height, current_y - initial_y)
			local geometry = string.format("%d,%d,%d,%d", x, y, width, height)
			if geometry ~= last_geometry then
				local dispatched = pcall(dispatch_window_geometry, active, x, y, width, height)
				if dispatched then
					last_geometry = geometry
				end
			end
		end

		socket.sleep(poll_interval)
	end

	stop_drag()
end

local command_server = nil

local function read_command(client)
	client:settimeout(0.01)
	local line = client:receive("*l")
	client:close()
	return line
end

accept_command = function(timeout)
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

handle_command = function(command)
	if command == "stop" then
		stop_drag()
		return true
	end

	return command == "quit"
end

local function start_drag()
	stop_drag()

	local active = target_window_info()
	if not active then
		return
	end

	local monitor = monitor_info(active.monitor_id)
	local monitor_name = monitor and monitor.name or nil
	local poll_interval = monitor and monitor.poll_interval or 0.008
	if active.floating then
		request("dispatch hl.dsp.window.resize()")
		return
	end

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
	disable_resize_animation()
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
