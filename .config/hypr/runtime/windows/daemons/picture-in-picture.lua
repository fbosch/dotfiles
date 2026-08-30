#!/usr/bin/env luajit

local socket = require("socket")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")
local json = require("lib.json")
local daemon = require("runtime.lib.daemon")
local placement = require("lib.pip_placement")
local pip = require("lib.picture_in_picture")
local rate_limit = require("lib.rate_limit")

-- Thin adapter around the PiP placement reducer: feeds IPC snapshots and
-- events into lib.pip_placement and interprets the returned commands.
local kit = daemon.new({})
local state = placement.new()
local acceptance_delivery_timeout_s = 1

local monitors_by_name = {}
local current_bars = {}
local native_updates_ready = false
local acceptance_socket_path = kit:socket_path("window-state.sock")

local function log(message)
	io.stderr:write("picture-in-picture: ", message, "\n")
end

local log_rate_limited, reset_rate_limit = rate_limit.new(log, 30, socket.gettime)

local function request(message)
	return kit:request(message) or ""
end

local function monitor_geometry_changed(previous, current)
	for name, monitor in pairs(current) do
		local old = previous[name]
		if
			old == nil
			or old.id ~= monitor.id
			or old.x ~= monitor.x
			or old.y ~= monitor.y
			or old.width ~= monitor.width
			or old.height ~= monitor.height
		then
			return true
		end
	end

	for name in pairs(previous) do
		if current[name] == nil then
			return true
		end
	end
	return false
end

local function refresh_monitors(query_opts)
	local refreshed, err = kit:monitors(query_opts)
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

	local geometry_changed = monitor_geometry_changed(monitors_by_name, by_name)
	monitors_by_name = by_name
	return true, geometry_changed
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

local function refresh_bars(waybar_visible)
	current_bars = bars_for(waybar_visible)
	return current_bars
end

local function accept_placement(value)
	local response, err = kit:request(pip.acceptance.encode(value) .. "\n", {
		path = acceptance_socket_path,
		timeout = acceptance_delivery_timeout_s,
	})
	if err ~= nil or response ~= "ok\n" then
		log_rate_limited("placement-acceptance", "accepted placement was not persisted")
		return
	end

	reset_rate_limit("placement-acceptance")
end

local function apply_commands(commands)
	for _, cmd in ipairs(commands) do
		if cmd.kind == "move" then
			request(
				string.format(
					"dispatch hl.dsp.window.move({ x = %d, y = %d, window = %s })",
					cmd.x,
					cmd.y,
					json.encode("address:" .. cmd.address)
				)
			)
		elseif cmd.kind == "tag" then
			request(
				string.format(
					"dispatch hl.dsp.window.tag({ tag = %s, window = %s })",
					json.encode((cmd.add and "+" or "-") .. cmd.tag),
					json.encode("address:" .. cmd.address)
				)
			)
		elseif cmd.kind == "preview" then
			if cmd.target then
				cmd.target.action = "show"
				ags_ipc.request("pip-snap-preview", json.encode(cmd.target))
			else
				ags_ipc.request("pip-snap-preview", '{"action":"hide"}')
			end
		elseif cmd.kind == "cursor-outline" then
			request(string.format("eval hl.plugin.cursor_outline.%s()", cmd.enabled and "on" or "off"))
		elseif cmd.kind == "accept-placement" then
			accept_placement(cmd.placement)
		elseif cmd.kind == "acceptance-timeout" then
			log_rate_limited("placement-observation", "final placement was not observed")
		end
	end
end

-- Lazy snapshot: IPC queries run only when the reducer actually reads a field.
local function make_input(now, event, bars, overrides)
	overrides = overrides or {}
	local cache = {
		monitors = monitors_by_name,
		bars = bars,
		clients = overrides.clients,
		active = overrides.active,
	}
	return setmetatable({ now = now, event = event }, {
		__index = function(_, key)
			if key == "clients" and cache.clients == nil then
				cache.clients = kit:clients()
			elseif key == "active" and cache.active == nil then
				cache.active = json.object(request("j/activewindow"))
			end
			return cache[key]
		end,
	})
end

local function place(now, event, bars, overrides)
	local _, commands = placement.place(state, make_input(now, event, bars, overrides))
	apply_commands(commands)
end

local function handle_control(message)
	if message == "interaction-updates-ready" then
		native_updates_ready = true
		return false
	end

	local action, address, direction = pip.control.decode(message)

	-- Use the pre-transition layer geometry while applying show/hide policy,
	-- then keep only the geometry for the resulting visibility state.
	local next_waybar_visible = action == "waybar-show" or (action ~= "waybar-hide" and state.waybar_visible)
	local transition_bars = current_bars
	if action == "waybar-show" or action == "waybar-hide" then
		transition_bars = refresh_bars(next_waybar_visible)
	end
	place(socket.gettime(), { type = "control", action = action, address = address, direction = direction }, transition_bars)
	if action == "waybar-hide" then
		current_bars = {}
	end
	return action == "quit"
end

local event_socket = nil
local control_socket = nil

local function cleanup_control_socket()
	if event_socket then
		event_socket:close()
		event_socket = nil
	end

	if control_socket then
		control_socket:close()
		control_socket = nil
	end
end

local function finite_number(value)
	value = tonumber(value)
	if value == nil or value ~= value or value == math.huge or value == -math.huge then
		return nil
	end
	return value
end

local function parse_interaction_update(line)
	local address, kind, monitor, x, y, width, height =
		line:match("^windowinteractionupdated>>([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)$")
	if not address or (kind ~= "move" and kind ~= "resize") then
		return nil
	end

	x = finite_number(x)
	y = finite_number(y)
	width = finite_number(width)
	height = finite_number(height)
	if not x or not y or not width or not height or width <= 0 or height <= 0 then
		return nil
	end

	if address:match("^0x") == nil then
		address = "0x" .. address
	end

	return {
		address = address,
		kind = kind,
		monitor = monitor,
		x = x,
		y = y,
		width = width,
		height = height,
	}
end

local function apply_interaction_update(update, now)
	native_updates_ready = true
	if
		update.kind ~= "move"
		or not state.dragging
		or update.address ~= state.dragging_address
	then
		return
	end

	local window = {
		address = update.address,
		monitor = update.monitor,
		at = { update.x, update.y },
		size = { update.width, update.height },
		floating = true,
		mapped = true,
		hidden = false,
		class = pip.class,
		title = pip.title,
		tags = {},
	}

	place(now, { type = "tick", native_interaction = true }, current_bars, { clients = { window }, active = window })
end

local function compositor_event(line, now)
	local name = line:match("^(%w+)")
	if name == nil then
		return
	end
	if name == "windowinteractionupdated" then
		local update = parse_interaction_update(line)
		if update then
			apply_interaction_update(update, now)
		end
		return
	end
	if name == "configreloaded" then
		local _, geometry_changed = refresh_monitors({ force = true })
		refresh_bars(state.waybar_visible)
		place(
			now,
			{ type = geometry_changed and "monitorchange" or "configreload" },
			geometry_changed and current_bars or nil
		)
		return
	end
	if name:match("^monitoradded") or name == "monitorremoved" then
		refresh_monitors({ force = true })
		refresh_bars(state.waybar_visible)
		place(now, { type = "monitorchange" }, current_bars)
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

local function run()
	refresh_monitors()
	state.waybar_visible = next(visible_waybar_layers()) ~= nil
	refresh_bars(state.waybar_visible)
	place(socket.gettime(), { type = "startup" }, current_bars)
	event_socket = kit:connect_events({ read_timeout = 0 })
	control_socket = kit:control_socket("pip-monitor.sock")

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

		if not state.dragging or not native_updates_ready or state.pending_acceptance then
			consider(state.next_observation_at)
		end
		if state.pending_acceptance then
			consider(state.pending_acceptance.deadline)
		end
		if state.dragging and not native_updates_ready then
			timeout = timeout and math.min(timeout, placement.drag_interval_s) or placement.drag_interval_s
		end
		consider(state.reconcile_at)

		local ready = socket.select({ control_socket:reader(), event_socket }, nil, timeout)
		for _, reader in ipairs(ready) do
			if reader == control_socket:reader() then
				local action = control_socket:handle_ready(handle_control)
				if action then
					return action
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
		local observation_due = state.next_observation_at ~= nil
			and state.next_observation_at ~= math.huge
			and now >= state.next_observation_at
		local observation_enabled = not state.dragging or not native_updates_ready or state.pending_acceptance ~= nil
		local reconcile_due = state.reconcile_at ~= nil and now >= state.reconcile_at
		if (observation_enabled and observation_due) or reconcile_due then
			place(now, { type = "tick" }, current_bars)
		end
	end
end

local ok, result = xpcall(run, debug.traceback)
ags_ipc.request("pip-snap-preview", '{"action":"hide"}')
cleanup_control_socket()
if ok == false then
	log(result)
	os.exit(1)
end
if result == "restart" then
	os.exit(daemon.restart_exit_status)
end
