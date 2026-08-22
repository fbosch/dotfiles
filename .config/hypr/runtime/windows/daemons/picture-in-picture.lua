#!/usr/bin/env luajit

local socket = require("socket")
local unix = require("socket.unix")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")
local pip = require("lib.picture_in_picture")

local monitor_cache_ttl_s = 10
local drag_interval_s = 0.08
local client_drag_settle_s = 0.2
local open_window_delay_s = 0.1
local waybar_position_vicinity = 12
local control_socket_path = hypr_ipc.instance_socket_path("pip-monitor.sock")

local monitors = {}
local monitor_cache_at = 0
local waybar_visible = false
local dragging = false
local dragging_address = nil
local drag_source = nil
local client_drag_settle_at = nil
local pip_geometries = {}
local next_pip_observation_at = 0
local preview_signature = nil
local resize_anchor = nil
local control_server = nil
local event_socket = nil
local owns_control_socket = false
local reconcile_at = nil
local reconcile_addresses = {}

local function log(message)
	io.stderr:write("picture-in-picture: ", message, "\n")
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return ""
	end

	local content = handle:read("*a")
	handle:close()
	return content
end

local function request(message)
	local ok, response = pcall(hypr_ipc.request, message)
	if ok then
		return response or ""
	end

	return ""
end

local function rectangle(left, top, width, height)
	return {
		left = tonumber(left) or 0,
		top = tonumber(top) or 0,
		width = tonumber(width) or 0,
		height = tonumber(height) or 0,
	}
end

local function overlaps(first, second)
	return first.left < second.left + second.width
		and second.left < first.left + first.width
		and first.top < second.top + second.height
		and second.top < first.top + first.height
end

local function refresh_monitors()
	if os.time() - monitor_cache_at <= monitor_cache_ttl_s and next(monitors) then
		return true
	end

	local refreshed = {}
	for _, monitor in ipairs(json.array(request("j/monitors"))) do
		local width = tonumber(monitor.width) or 0
		local height = tonumber(monitor.height) or 0
		if monitor.transform == 1 or monitor.transform == 3 then
			width, height = height, width
		end
		refreshed[monitor.name] = {
			name = monitor.name,
			id = tostring(monitor.id),
			x = tonumber(monitor.x) or 0,
			y = tonumber(monitor.y) or 0,
			width = width,
			height = height,
		}
	end

	if next(refreshed) == nil then
		return next(monitors) ~= nil
	end

	monitors = refreshed
	monitor_cache_at = os.time()
	return true
end

local function monitor_for(window)
	for _, monitor in pairs(monitors) do
		if monitor.id == tostring(window.monitor) then
			return monitor
		end
	end
end

local function predicted_waybar_layers()
	local config = json.object(read_file(os.getenv("HOME") .. "/.config/waybar/config"))
	local height = tonumber(config.height)
	if config.position ~= "bottom" or not height then
		return {}
	end

	local left = tonumber(config["margin-left"]) or 0
	local right = tonumber(config["margin-right"]) or 0
	local bottom = tonumber(config["margin-bottom"]) or 0
	local layers = {}
	for name, monitor in pairs(monitors) do
		layers[name] = {
			rectangle(
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
		local monitor = monitors[name]
		local monitor_rect = monitor and rectangle(monitor.x, monitor.y, monitor.width, monitor.height)
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				local layer_rect = rectangle(layer.x, layer.y, layer.w, layer.h)
				if
					layer.namespace == "waybar"
					and (tonumber(layer.alpha) or 0) > 0
					and monitor_rect
					and overlaps(layer_rect, monitor_rect)
				then
					visible[name] = visible[name] or {}
					visible[name][#visible[name] + 1] = layer_rect
				end
			end
		end
	end
	return visible
end

local function is_pip(window)
	return window.mapped ~= false
		and window.hidden ~= true
		and window.floating == true
		and window.class == pip.class
		and window.title == pip.title
end

local function pip_geometry(window)
	return string.format("%s:%s:%s", tostring(window.monitor), tostring(window.at[1]), tostring(window.at[2])),
		string.format("%s:%s", tostring(window.size[1]), tostring(window.size[2]))
end

local function observe_client_drag()
	local now = socket.gettime()
	local seen = {}
	local moved_address = nil
	for _, window in ipairs(json.array(request("j/clients"))) do
		if is_pip(window) then
			local address = window.address
			local position, size = pip_geometry(window)
			local previous = pip_geometries[address]
			seen[address] = true
			if previous and previous.position ~= position and previous.size == size then
				moved_address = moved_address or address
			end
			pip_geometries[address] = { position = position, size = size }
		end
	end

	for address in pairs(pip_geometries) do
		if seen[address] == nil then
			pip_geometries[address] = nil
		end
	end

	if drag_source == "client" then
		if moved_address == dragging_address then
			client_drag_settle_at = now + client_drag_settle_s
		end
		return next(seen) ~= nil
	end

	if dragging == false and moved_address then
		dragging = true
		dragging_address = moved_address
		drag_source = "client"
		client_drag_settle_at = now + client_drag_settle_s
	end

	return next(seen) ~= nil
end

local function corner_x(window, monitor)
	local left_x = monitor.x + pip.margin
	local right_x = monitor.x + monitor.width - (tonumber(window.size[1]) or 0) - pip.margin
	if math.abs((tonumber(window.at[1]) or 0) - left_x) <= math.abs((tonumber(window.at[1]) or 0) - right_x) then
		return left_x
	end

	return right_x
end

local function bottom_y(window, monitor, x, bars)
	local height = tonumber(window.size[2]) or 0
	local y = monitor.y + monitor.height - height - pip.margin
	local target = rectangle(x, y, tonumber(window.size[1]) or 0, height)
	for _, bar in ipairs(bars[monitor.name] or {}) do
		if overlaps(target, bar) then
			y = math.min(y, bar.top - height - pip.overlap_gap)
		end
	end

	return y
end

local function move_window(window, x, y)
	if (tonumber(window.at[1]) or 0) == x and (tonumber(window.at[2]) or 0) == y then
		return
	end

	request(
		string.format(
			"dispatch hl.dsp.window.move({ x = %d, y = %d, window = %s })",
			x,
			y,
			json.encode("address:" .. window.address)
		)
	)
end

local function snap_target(window, monitor, bars)
	local x = tonumber(window.at[1]) or 0
	local y = tonumber(window.at[2]) or 0
	local width = tonumber(window.size[1]) or 0
	local height = tonumber(window.size[2]) or 0
	local left_distance = math.abs(x - monitor.x)
	local right_distance = math.abs(x + width - monitor.x - monitor.width)
	local top_distance = math.abs(y - monitor.y)
	local bottom_distance = math.abs(y + height - monitor.y - monitor.height)
	if
		math.min(left_distance, right_distance) > pip.snap_vicinity
		or math.min(top_distance, bottom_distance) > pip.snap_vicinity
	then
		return nil
	end

	local left = left_distance <= right_distance
	local top = top_distance <= bottom_distance
	local target_x = left and monitor.x + pip.margin or monitor.x + monitor.width - width - pip.margin
	local target_y = top and monitor.y + pip.margin or bottom_y(window, monitor, target_x, bars)
	local corner = (top and "top" or "bottom") .. "-" .. (left and "left" or "right")
	return {
		monitor = monitor.name,
		x = target_x - monitor.x,
		y = target_y - monitor.y,
		width = width,
		height = height,
		rounding = pip.rounding,
		corner = corner,
	}
end

local function has_tag(window, expected)
	for _, tag in ipairs(window.tags or {}) do
		if tag:gsub("%*$", "") == expected then
			return true
		end
	end

	return false
end

local function clear_pip_corner_tags(window, keep)
	for _, candidate in pairs(pip.corners) do
		if candidate.tag ~= keep and has_tag(window, candidate.tag) then
			request(
				string.format(
					"dispatch hl.dsp.window.tag({ tag = %s, window = %s })",
					json.encode("-" .. candidate.tag),
					json.encode("address:" .. window.address)
				)
			)
		end
	end
end

local function tag_pip_corner(window, corner)
	local tag = pip.corners[corner].tag
	clear_pip_corner_tags(window, tag)
	if has_tag(window, tag) == false then
		request(
			string.format(
				"dispatch hl.dsp.window.tag({ tag = %s, window = %s })",
				json.encode("+" .. tag),
				json.encode("address:" .. window.address)
			)
		)
	end
end

local function tagged_corner(window)
	for corner, candidate in pairs(pip.corners) do
		if has_tag(window, candidate.tag) then
			return corner
		end
	end
end

local function move_pip_corner(direction, address)
	if direction ~= "left" and direction ~= "right" and direction ~= "up" and direction ~= "down" then
		return
	end

	refresh_monitors()
	local bars = waybar_visible and predicted_waybar_layers() or visible_waybar_layers()
	for _, window in ipairs(json.array(request("j/clients"))) do
		if is_pip(window) and window.address == address then
			local monitor = monitor_for(window)
			if not monitor then
				return
			end

			local corner = tagged_corner(window) or "bottom-right"
			local left = corner:match("left$") ~= nil
			local top = corner:match("^top") ~= nil
			if direction == "left" then
				left = true
			end
			if direction == "right" then
				left = false
			end
			if direction == "up" then
				top = true
			end
			if direction == "down" then
				top = false
			end

			local width = tonumber(window.size[1]) or 0
			local target_x = left and monitor.x + pip.margin or monitor.x + monitor.width - width - pip.margin
			local target_y = top and monitor.y + pip.margin or bottom_y(window, monitor, target_x, bars)
			local target_corner = (top and "top" or "bottom") .. "-" .. (left and "left" or "right")
			tag_pip_corner(window, target_corner)
			move_window(window, target_x, target_y)
			return
		end
	end
end

local function begin_resize()
	refresh_monitors()
	local window = json.object(request("j/activewindow"))
	if not is_pip(window) then
		resize_anchor = nil
		return
	end

	local corner = tagged_corner(window)
	if not corner then
		resize_anchor = nil
		return
	end

	local x = tonumber(window.at[1]) or 0
	local y = tonumber(window.at[2]) or 0
	local width = tonumber(window.size[1]) or 0
	local height = tonumber(window.size[2]) or 0
	resize_anchor = {
		address = window.address,
		left = corner:match("left$") ~= nil,
		top = corner:match("^top") ~= nil,
		x = corner:match("left$") and x or x + width,
		y = corner:match("^top") and y or y + height,
	}
end

local function finish_resize()
	local anchor = resize_anchor
	resize_anchor = nil
	if not anchor then
		return
	end

	for _, window in ipairs(json.array(request("j/clients"))) do
		if window.address == anchor.address and is_pip(window) then
			local width = tonumber(window.size[1]) or 0
			local height = tonumber(window.size[2]) or 0
			local x = anchor.left and anchor.x or anchor.x - width
			local y = anchor.top and anchor.y or anchor.y - height
			move_window(window, x, y)
			return
		end
	end
end

local function set_snap_preview(target)
	local signature = target
			and string.format(
				"%s:%d:%d:%d:%d:%d",
				target.monitor,
				target.x,
				target.y,
				target.width,
				target.height,
				target.rounding
			)
		or nil
	if signature == preview_signature then
		return
	end

	preview_signature = signature
	if target then
		target.action = "show"
		ags_ipc.request("pip-snap-preview", json.encode(target))
	else
		ags_ipc.request("pip-snap-preview", '{"action":"hide"}')
	end
end

local function stop_drag()
	if dragging_address then
		pip_geometries[dragging_address] = nil
	end

	dragging = false
	dragging_address = nil
	drag_source = nil
	client_drag_settle_at = nil
	next_pip_observation_at = socket.gettime()
	set_snap_preview(nil)
end

local function update_snap_preview()
	refresh_monitors()
	local bars = waybar_visible and predicted_waybar_layers() or visible_waybar_layers()
	local active = json.object(request("j/activewindow"))
	if is_pip(active) and (dragging_address == nil or active.address == dragging_address) then
		local monitor = monitor_for(active)
		local target = monitor and snap_target(active, monitor, bars)
		set_snap_preview(target)
		return
	end

	for _, window in ipairs(json.array(request("j/clients"))) do
		if is_pip(window) and window.address == dragging_address then
			local monitor = monitor_for(window)
			local target = monitor and snap_target(window, monitor, bars)
			if target then
				set_snap_preview(target)
				return
			end
		end
	end

	set_snap_preview(nil)
end

local function snap_pip(address)
	refresh_monitors()
	local bars = waybar_visible and predicted_waybar_layers() or visible_waybar_layers()
	for _, window in ipairs(json.array(request("j/clients"))) do
		if is_pip(window) and (address == nil or window.address == address) then
			local monitor = monitor_for(window)
			if monitor then
				local target = snap_target(window, monitor, bars)
				if target then
					tag_pip_corner(window, target.corner)
					move_window(window, target.x + monitor.x, target.y + monitor.y)
				else
					clear_pip_corner_tags(window)
				end
			end
		end
	end
end

local function move_pip(mode, address, assign_default_corner)
	refresh_monitors()
	local bars = mode == "show" and predicted_waybar_layers() or visible_waybar_layers()
	for _, window in ipairs(json.array(request("j/clients"))) do
		if is_pip(window) and (address == nil or window.address == address) then
			local monitor = monitor_for(window)
			if monitor then
				local width = tonumber(window.size[1]) or 0
				local height = tonumber(window.size[2]) or 0
				local corner = tagged_corner(window)
				if corner == nil and assign_default_corner then
					local default_x = monitor.x + monitor.width - width - pip.margin
					local default_y = monitor.y + monitor.height - height - pip.margin
					-- A window-state rule has already restored any non-default position.
					if (tonumber(window.at[1]) or 0) ~= default_x or (tonumber(window.at[2]) or 0) ~= default_y then
						return
					end
					corner = "bottom-right"
					tag_pip_corner(window, corner)
				end
				local normal_x = corner and corner:match("left$") and monitor.x + pip.margin
					or corner_x(window, monitor)
				local normal_y = monitor.y + monitor.height - height - pip.margin
				local window_rect = rectangle(window.at[1], window.at[2], width, height)
				local target_y
				if corner and corner:match("^bottom") then
					target_y = mode == "show" and bottom_y(window, monitor, normal_x, bars) or normal_y
				else
					for _, bar in ipairs(bars[monitor.name] or {}) do
						if mode == "show" and overlaps(window_rect, bar) then
							target_y = bottom_y(window, monitor, normal_x, bars)
							break
						elseif mode == "hide" then
							local avoidance_y = bar.top - height - pip.overlap_gap
							if
								math.abs(window_rect.left - normal_x) <= waybar_position_vicinity
								and math.abs(window_rect.top - avoidance_y) <= waybar_position_vicinity
							then
								target_y = normal_y
							end
						end
					end
				end
				if target_y then
					move_window(window, normal_x, target_y)
				end
			end
		end
	end
end

local function handle_control(control)
	control:settimeout(0.05)
	local message = control:receive("*l")
	local action, address
	if message then
		action, address = message:match("^(%S+)%s*(.*)$")
	end
	if address == "" then
		address = nil
	end
	if action == "drag-start" then
		dragging = true
		dragging_address = address
		drag_source = "bind"
		client_drag_settle_at = nil
	elseif action == "drag-end" then
		if dragging then
			update_snap_preview()
			snap_pip(dragging_address)
		end
		stop_drag()
	elseif action == "drag-cancel" then
		stop_drag()
	elseif action == "resize-start" then
		begin_resize()
	elseif action == "resize-end" then
		finish_resize()
	elseif action == "move" then
		if address then
			local direction, window_address = address:match("^(%S+)%s+(%S+)$")
			if direction and window_address then
				move_pip_corner(direction, window_address)
			end
		end
	elseif action == "waybar-show" then
		move_pip("show")
		waybar_visible = true
	elseif action == "waybar-hide" then
		move_pip("hide")
		waybar_visible = false
	elseif action == "ping" then
		-- Side-effect-free health check for the launcher.
	elseif action == "quit" then
		control:send("ok\n")
		control:close()
		return true
	end
	control:send("ok\n")
	control:close()
	return false
end

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

local function run()
	refresh_monitors()
	waybar_visible = next(visible_waybar_layers()) ~= nil
	move_pip(waybar_visible and "show" or "hide")
	event_socket = hypr_ipc.connect_event_socket({ read_timeout = 0 })

	control_server = assert(unix())
	assert(control_server:bind(control_socket_path))
	assert(control_server:listen())
	owns_control_socket = true
	control_server:settimeout(0)

	while true do
		local now = socket.gettime()
		if now >= next_pip_observation_at then
			-- Client-initiated titlebar drags do not have an IPC start/end event.
			local has_pip = observe_client_drag()
			next_pip_observation_at = has_pip and now + drag_interval_s or math.huge
		end

		if dragging then
			update_snap_preview()
			if drag_source == "client" and client_drag_settle_at and now >= client_drag_settle_at then
				snap_pip(dragging_address)
				stop_drag()
			end
		end

		local timeout = nil
		if next_pip_observation_at ~= math.huge then
			timeout = math.max(0, next_pip_observation_at - now)
		end
		if dragging then
			timeout = timeout and math.min(timeout, drag_interval_s) or drag_interval_s
		end
		if client_drag_settle_at then
			local settle_delay = math.max(0, client_drag_settle_at - now)
			timeout = timeout and math.min(timeout, settle_delay) or settle_delay
		end
		if reconcile_at then
			local delay = math.max(0, reconcile_at - now)
			timeout = timeout and math.min(timeout, delay) or delay
		end

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
				local opened = event and event:match("^openwindow") ~= nil
				local client_changed = event
					and (event:match("^openwindow") ~= nil or event:match("^closewindow") ~= nil)
				if client_changed then
					next_pip_observation_at = 0
				end
				local resized = event
					and event:match("^resizewindow") ~= nil
					and dragging == false
					and resize_anchor == nil
				local should_reconcile = opened or resized
				if should_reconcile then
					local address = event:match(">>([^,]+)")
					if address then
						if address:match("^0x") == nil then
							address = "0x" .. address
						end
						reconcile_addresses[address] = reconcile_addresses[address] or opened
						reconcile_at = socket.gettime() + open_window_delay_s
					end
				end
				if err == "closed" then
					event_socket:close()
					event_socket = hypr_ipc.connect_event_socket({ read_timeout = 0 })
				end
			end
		end

		if reconcile_at and socket.gettime() >= reconcile_at then
			reconcile_at = nil
			refresh_monitors()
			waybar_visible = next(visible_waybar_layers()) ~= nil
			for address, assign_default_corner in pairs(reconcile_addresses) do
				move_pip(waybar_visible and "show" or "hide", address, assign_default_corner)
				pip_geometries[address] = nil
				reconcile_addresses[address] = nil
			end
			next_pip_observation_at = 0
		end
	end
end

local ok, err = xpcall(run, debug.traceback)
set_snap_preview(nil)
cleanup_control_socket()
if ok == false then
	log(err)
	os.exit(1)
end
