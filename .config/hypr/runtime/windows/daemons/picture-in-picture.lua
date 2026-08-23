#!/usr/bin/env luajit

local socket = require("socket")
local unix = require("socket.unix")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")
local json = require("lib.json")
local daemon = require("runtime.lib.daemon")
local placement = require("lib.pip_placement")
local pip = require("lib.picture_in_picture")

-- Thin adapter around the PiP placement reducer: feeds IPC snapshots and
-- events into lib.pip_placement and interprets the returned commands.
local kit = daemon.new({})
local control_socket_path = kit:socket_path("pip-monitor.sock")
local state = placement.new()

local monitors_by_name = {}

local function log(message)
	io.stderr:write("picture-in-picture: ", message, "\n")
end

local function request(message)
	return kit:request(message) or ""
end

local function refresh_monitors()
	local refreshed, err = kit:monitors()
	if err ~= nil then
		return next(monitors_by_name) ~= nil
	end

	local by_name = {}
	for _, monitor in ipairs(refreshed) do
		by_name[monitor.name] = monitor
	end

	if next(by_name) == nil then
		return next(monitors_by_name) ~= nil
	end

	monitors_by_name = by_name
	return true
end

local function predicted_waybar_layers()
	local config = json.object(kit:read_file(os.getenv("HOME") .. "/.config/waybar/config") or "")
	local height = tonumber(config.height)
	if config.position ~= "bottom" or not height then
		return {}
	end

	local left = tonumber(config["margin-left"]) or 0
	local right = tonumber(config["margin-right"]) or 0
	local bottom = tonumber(config["margin-bottom"]) or 0
	local layers = {}
	for name, monitor in pairs(monitors_by_name) do
		layers[name] = {
			placement.rectangle(
				monitor.x + left,
				monitor.y + monitor.height - height - bottom,
				monitor.width - left - right,
				height
			),
		}
	end
	return layers
end

local function visible_waybar_layers()
	local layers = json.object(request("j/layers"))
	local visible = {}
	for name, monitor_layers in pairs(layers) do
		local monitor = monitors_by_name[name]
		local monitor_rect = monitor and placement.rectangle(monitor.x, monitor.y, monitor.width, monitor.height)
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				local layer_rect = placement.rectangle(layer.x, layer.y, layer.w, layer.h)
				if
					layer.namespace == "waybar"
					and (tonumber(layer.alpha) or 0) > 0
					and monitor_rect
					and placement.overlaps(layer_rect, monitor_rect)
				then
					visible[name] = visible[name] or {}
					visible[name][#visible[name] + 1] = layer_rect
				end
			end
		end
	end
	return visible
end

local function bars_for(waybar_visible)
	return waybar_visible and predicted_waybar_layers() or visible_waybar_layers()
end

local function apply_commands(commands)
	for _, cmd in ipairs(commands) do
		if cmd.kind == "move" then
			request(string.format(
				"dispatch hl.dsp.window.move({ x = %d, y = %d, window = %s })",
				cmd.x,
				cmd.y,
				json.encode("address:" .. cmd.address)
			))
		elseif cmd.kind == "tag" then
			request(string.format(
				"dispatch hl.dsp.window.tag({ tag = %s, window = %s })",
				json.encode((cmd.add and "+" or "-") .. cmd.tag),
				json.encode("address:" .. cmd.address)
			))
		elseif cmd.kind == "preview" then
			if cmd.target then
				cmd.target.action = "show"
				ags_ipc.request("pip-snap-preview", json.encode(cmd.target))
			else
				ags_ipc.request("pip-snap-preview", '{"action":"hide"}')
			end
		end
	end
end

-- Lazy snapshot: IPC queries run only when the reducer actually reads a field.
local function make_input(now, event, bars)
	local cache = { monitors = monitors_by_name, bars = bars }
	return setmetatable({ now = now, event = event }, {
		__index = function(_, key)
			if key == "clients" then
				cache.clients = kit:clients()
			elseif key == "active" then
				cache.active = json.object(request("j/activewindow"))
			end
			return cache[key]
		end,
	})
end

local function place(now, event, bars)
	local _, commands = placement.place(state, make_input(now, event, bars))
	apply_commands(commands)
end

local function handle_control(control)
	control:settimeout(0.05)
	local message = control:receive("*l")
	local action, address, direction = pip.control.decode(message)

	-- Bars must reflect the visibility this command transitions to.
	local bars = bars_for(action == "waybar-show" or (action ~= "waybar-hide" and state.waybar_visible))
	place(socket.gettime(), { type = "control", action = action, address = address, direction = direction }, bars)

	control:send("ok\n")
	control:close()
	return action == "quit"
end

local event_socket = nil
local control_server = nil
local owns_control_socket = false

local function cleanup_control_socket()
	if event_socket then
		event_socket:close()
		event_socket = nil
	end

	if control_server then
		control_server:close()
		control_server = nil
	end

	if owns_control_socket then
		os.remove(control_socket_path)
		owns_control_socket = false
	end
end

local function compositor_event(line, now)
	local name = line:match("^(%w+)")
	if name == nil then
		return
	end

	local address
	if name == "openwindow" or name == "resizewindow" then
		address = line:match(">>([^,]+)")
		if address and address:match("^0x") == nil then
			address = "0x" .. address
		end
	end

	place(now, { type = "compositor", name = name, address = address })
end

local function tick_due(now)
	if state.dragging then
		return true
	end
	if now >= state.next_observation_at then
		return true
	end
	if state.settle_at and now >= state.settle_at then
		return true
	end
	return state.reconcile_at ~= nil and now >= state.reconcile_at
end

local function run()
	refresh_monitors()
	state.waybar_visible = next(visible_waybar_layers()) ~= nil
	place(socket.gettime(), { type = "startup" }, bars_for(state.waybar_visible))
	event_socket = kit:connect_events({ read_timeout = 0 })

	control_server = assert(unix())
	assert(control_server:bind(control_socket_path))
	assert(control_server:listen())
	owns_control_socket = true
	control_server:settimeout(0)

	while true do
		local now = socket.gettime()

		local timeout = nil
		local function consider(deadline)
			if deadline == nil or deadline == math.huge then
				return
			end
			local delay = math.max(0, deadline - now)
			timeout = timeout and math.min(timeout, delay) or delay
		end

		consider(state.next_observation_at)
		if state.dragging then
			timeout = timeout and math.min(timeout, placement.drag_interval_s) or placement.drag_interval_s
		end
		consider(state.settle_at)
		consider(state.reconcile_at)

		local ready = socket.select({ control_server, event_socket }, nil, timeout)
		for _, reader in ipairs(ready) do
			if reader == control_server then
				local control = control_server:accept()
				if control and handle_control(control) then
					return
				end
			elseif reader == event_socket then
				local event, err, partial = event_socket:receive("*l")
				event = event or partial
				if event and event ~= "" then
					compositor_event(event, socket.gettime())
				end
				if err == "closed" then
					event_socket:close()
					event_socket = kit:connect_events({ read_timeout = 0 })
				end
			end
		end

		now = socket.gettime()
		if tick_due(now) then
			place(now, { type = "tick" }, bars_for(state.waybar_visible))
		end
	end
end

local ok, err = xpcall(run, debug.traceback)
ags_ipc.request("pip-snap-preview", '{"action":"hide"}')
cleanup_control_socket()
if ok == false then
	log(err)
	os.exit(1)
end
