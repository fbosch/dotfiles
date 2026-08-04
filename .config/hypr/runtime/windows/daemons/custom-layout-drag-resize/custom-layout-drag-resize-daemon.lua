#!/usr/bin/env luajit

local socket = require("socket")
local unix = require("socket.unix")
local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")
local monitor_role = require("lib.monitor_role")
local control_protocol = require("runtime.windows.daemons.custom-layout-drag-resize.control-protocol")

local command_socket_path = hypr_ipc.instance_socket_path("clr.sock")
local state_file = hypr_ipc.instance_path("custom-layout-drag-resize.state")
local pid_file = hypr_ipc.instance_path("custom-layout-drag-resize.pid")
local profile_mode_file = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-profiles/profile-overlay.mode"
local min_floating_size = 64
local drag_numerator = 1
local drag_denominator = 1
local monitors_by_id = {}
local drag_active = false
local tiled_drag_active = false
local latest_control_sequence = 0
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

	eval([[require("animations").restore_windows_move()]])
end

local function save_pending_resize()
	request([[dispatch hl.dsp.layout("save-resize")]])
end

local function active_monitor_info()
	monitors_by_id = {}
	for _, monitor in ipairs(json.array(request("j/monitors"))) do
		local id = monitor.id
		if id then
			local refresh = monitor.refreshRate or 60
			monitors_by_id[id] = {
				name = monitor.name,
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
	local active = json.object(request("j/activewindow"))
	local x, y = active.at and active.at[1], active.at and active.at[2]
	local width, height = active.size and active.size[1], active.size and active.size[2]
	local monitor_id = active.monitor
	if not monitor_id or not x or not y or not width or not height then
		return nil
	end

	return {
		address = active.address,
		monitor_id = monitor_id,
		floating = active.floating == true,
		x = x,
		y = y,
		width = width,
		height = height,
	}
end

local function active_workspace_layout()
	return json.object(request("j/activeworkspace")).tiledLayout
end

local cursor_position

local function window_contains_cursor(window, x, y)
	return x >= window.x and x < window.x + window.width and y >= window.y and y < window.y + window.height
end

local function client_window_info(client)
	local x, y = client.at and client.at[1], client.at and client.at[2]
	local width, height = client.size and client.size[1], client.size and client.size[2]
	if not client.address or not client.monitor or not x or not y or not width or not height then
		return nil
	end

	return {
		address = client.address,
		monitor_id = client.monitor,
		floating = client.floating == true,
		mapped = client.mapped,
		hidden = client.hidden,
		visible = client.visible,
		acceptsInput = client.acceptsInput,
		focusHistoryID = client.focusHistoryID,
		x = x,
		y = y,
		width = width,
		height = height,
	}
end

local function client_contains_cursor(client, x, y)
	if not client then
		return false
	end

	if client.mapped ~= true or client.hidden == true or client.visible ~= true or client.acceptsInput == false then
		return false
	end

	return window_contains_cursor(client, x, y)
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
	local best = nil
	for _, candidate in ipairs(json.array(request("j/clients"))) do
		local client = client_window_info(candidate)
		if client_contains_cursor(client, x, y) and preferred_hover_candidate(client, best) then
			best = client
		end
	end

	return best
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

	local active = active_window_info()
	if active and window_contains_cursor(active, x, y) then
		return active, x, y
	end

	local hovered = hovered_window_info(x, y)
	if not hovered or not focus_window(hovered.address) then
		return active, x, y
	end

	return hovered, x, y
end

local function cursor_axis(axis)
	local value = json.object(request("j/cursorpos"))[axis]
	if not value then
		error("cursor response missing " .. axis)
	end

	return value
end

function cursor_position()
	local position = json.object(request("j/cursorpos"))
	local x = position.x
	local y = position.y
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
	if tiled_drag_active then
		pcall(save_pending_resize)
		tiled_drag_active = false
	end

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
	client:settimeout(0)
	local command = line and control_protocol.parse(line)
	if command then
		client:send("ok\n")
	else
		client:send("error\n")
	end
	client:close()
	return command
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
	if not command or control_protocol.is_newer(command, latest_control_sequence) == false then
		return false
	end

	if command.sequence then
		latest_control_sequence = command.sequence
	end

	if command.action == "stop" then
		stop_drag()
		return true
	end

	return command.action == "quit"
end

local function start_drag()
	stop_drag()

	local active, initial_x, initial_y = target_window_info()
	if not active then
		return
	end

	local monitor = monitor_info(active.monitor_id)
	local role = monitor_role.for_name(monitor and monitor.name)
	local poll_interval = monitor and monitor.poll_interval or 0.008
	if active.floating then
		start_floating_drag(active, poll_interval)
		return
	end

	local axis, command
	local layout = active_workspace_layout()
	if layout == "lua:ultrawide_master" and role == monitor_role.portrait then
		axis = "y"
		command = "resize-y-at"
	elseif layout == "lua:ultrawide_master" then
		axis = "x"
		command = "resize-x-at"
	elseif layout == "lua:portrait_rows" then
		axis = "y"
		command = "resize-y-at"
	else
		request("dispatch hl.dsp.window.resize()")
		return
	end

	local initial = axis == "x" and initial_x or initial_y
	if not initial then
		initial = cursor_axis(axis)
	end
	local edge = resize_edge(axis, initial, active.x, active.y, active.width, active.height)
	drag_active = true
	tiled_drag_active = true
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
		local command = accept_command(0.1)
		if command and control_protocol.is_newer(command, latest_control_sequence) == false then
		elseif command and command.sequence then
			latest_control_sequence = command.sequence
			if command.action == "start" then
				pcall(start_drag)
				stop_drag()
			elseif command.action == "stop" then
				stop_drag()
			end
		elseif command and command.action == "ping" then
			-- Health check for the shell wrapper's singleton guard.
		elseif command and command.action == "quit" then
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
