-- Pure PiP placement reducer: owns snap geometry, waybar avoidance, the
-- client-drag state machine, corner-tag policy, and preview dedup behind one
-- interface. place(state, input) → (state, commands) over plain tables; the
-- picture-in-picture daemon adapts IPC data in and interprets commands out.
-- See CONTEXT.md ("PiP placement").

local pip = require("lib.picture_in_picture")

local M = {}

local drag_interval_s = 0.08
local client_drag_settle_s = 0.2
local open_window_delay_s = 0.1
local waybar_position_vicinity = 12

M.drag_interval_s = drag_interval_s

function M.rectangle(left, top, width, height)
	return {
		left = tonumber(left) or 0,
		top = tonumber(top) or 0,
		width = tonumber(width) or 0,
		height = tonumber(height) or 0,
	}
end

function M.overlaps(first, second)
	return first.left < second.left + second.width
		and second.left < first.left + first.width
		and first.top < second.top + second.height
		and second.top < first.top + first.height
end

function M.new(opts)
	opts = opts or {}
	return {
		-- Written by the adapter (startup detection, waybar-show/hide peek);
		-- read here to pick show/hide modes for reconciliation moves.
		waybar_visible = opts.waybar_visible == true,
		geometries = {},
		expected_positions = {},
		dragging = false,
		dragging_address = nil,
		drag_source = nil,
		settle_at = nil,
		next_observation_at = 0,
		preview_signature = nil,
		resize_anchor = nil,
		reconcile_at = nil,
		reconcile_addresses = {},
	}
end

local function is_pip(window)
	return window ~= nil
		and window.mapped ~= false
		and window.hidden ~= true
		and window.floating == true
		and pip.matches(window)
end

local function monitor_for(window, monitors)
	for _, monitor in pairs(monitors) do
		if monitor.id == tostring(window.monitor) then
			return monitor
		end
	end
end

local function geometry_keys(window)
	local position = string.format("%s:%s:%s", tostring(window.monitor), tostring(window.at[1]), tostring(window.at[2]))
	local size = string.format("%s:%s", tostring(window.size[1]), tostring(window.size[2]))
	return position, size
end

local function has_tag(window, expected)
	for _, tag in ipairs(window.tags or {}) do
		if tag:gsub("%*$", "") == expected then
			return true
		end
	end

	return false
end

local function emit_tag(commands, window, tag, add)
	commands[#commands + 1] = { kind = "tag", address = window.address, tag = tag, add = add }
end

local function clear_corner_tags(commands, window, keep)
	for _, candidate in pairs(pip.corners) do
		if candidate.tag ~= keep and has_tag(window, candidate.tag) then
			emit_tag(commands, window, candidate.tag, false)
		end
	end
end

local function tag_corner(commands, window, corner)
	local tag = pip.corners[corner].tag
	clear_corner_tags(commands, window, tag)
	if has_tag(window, tag) == false then
		emit_tag(commands, window, tag, true)
	end
end

local function tagged_corner(window)
	for corner, candidate in pairs(pip.corners) do
		if has_tag(window, candidate.tag) then
			return corner
		end
	end
end

local function move_window(state, commands, window, x, y)
	if (tonumber(window.at[1]) or 0) == x and (tonumber(window.at[2]) or 0) == y then
		return
	end

	state.expected_positions[window.address] =
		string.format("%s:%s:%s", tostring(window.monitor), tostring(x), tostring(y))
	commands[#commands + 1] = { kind = "move", address = window.address, x = x, y = y }
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
	local target = M.rectangle(x, y, tonumber(window.size[1]) or 0, height)
	for _, bar in ipairs(bars[monitor.name] or {}) do
		if M.overlaps(target, bar) then
			y = math.min(y, bar.top - height - pip.overlap_gap)
		end
	end

	return y
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

local function observe_client_drag(state, now, clients)
	local seen = {}
	local moved_address = nil
	for _, window in ipairs(clients) do
		if is_pip(window) then
			local address = window.address
			local position, size = geometry_keys(window)
			local previous = state.geometries[address]
			local expected_position = state.expected_positions[address]
			seen[address] = true
			if expected_position == position then
				state.expected_positions[address] = nil
			elseif previous and previous.position ~= position and previous.size == size then
				state.expected_positions[address] = nil
				moved_address = moved_address or address
			end
			state.geometries[address] = { position = position, size = size }
		end
	end

	for address in pairs(state.geometries) do
		if seen[address] == nil then
			state.geometries[address] = nil
			state.expected_positions[address] = nil
		end
	end

	if state.drag_source == "client" then
		if moved_address == state.dragging_address then
			state.settle_at = now + client_drag_settle_s
		end
		return next(seen) ~= nil
	end

	if state.dragging == false and moved_address then
		state.dragging = true
		state.dragging_address = moved_address
		state.drag_source = "client"
		state.settle_at = now + client_drag_settle_s
	end

	return next(seen) ~= nil
end

local function set_preview(state, commands, target)
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
	if signature == state.preview_signature then
		return
	end

	state.preview_signature = signature
	commands[#commands + 1] = { kind = "preview", target = target }
	commands[#commands + 1] = { kind = "cursor-outline", enabled = target ~= nil }
end

local function update_preview(state, input, commands)
	local active = input.active
	if is_pip(active) and (state.dragging_address == nil or active.address == state.dragging_address) then
		local monitor = monitor_for(active, input.monitors)
		local target = monitor and snap_target(active, monitor, input.bars)
		set_preview(state, commands, target)
		return
	end

	for _, window in ipairs(input.clients) do
		if is_pip(window) and window.address == state.dragging_address then
			local monitor = monitor_for(window, input.monitors)
			local target = monitor and snap_target(window, monitor, input.bars)
			if target then
				set_preview(state, commands, target)
				return
			end
		end
	end

	set_preview(state, commands, nil)
end

local function stop_drag(state, now, commands)
	if state.dragging_address then
		state.geometries[state.dragging_address] = nil
	end

	state.dragging = false
	state.dragging_address = nil
	state.drag_source = nil
	state.settle_at = nil
	state.next_observation_at = now
	set_preview(state, commands, nil)
end

local function snap_pip(state, address, input, commands)
	for _, window in ipairs(input.clients) do
		if is_pip(window) and (address == nil or window.address == address) then
			local monitor = monitor_for(window, input.monitors)
			if monitor then
				local target = snap_target(window, monitor, input.bars)
				if target then
					tag_corner(commands, window, target.corner)
					move_window(state, commands, window, target.x + monitor.x, target.y + monitor.y)
				else
					clear_corner_tags(commands, window)
				end
			end
		end
	end
end

local function move_pip_corner(state, direction, address, input, commands)
	if direction ~= "left" and direction ~= "right" and direction ~= "up" and direction ~= "down" then
		return
	end

	for _, window in ipairs(input.clients) do
		if is_pip(window) and window.address == address then
			local monitor = monitor_for(window, input.monitors)
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
			local target_y = top and monitor.y + pip.margin or bottom_y(window, monitor, target_x, input.bars)
			local target_corner = (top and "top" or "bottom") .. "-" .. (left and "left" or "right")
			tag_corner(commands, window, target_corner)
			move_window(state, commands, window, target_x, target_y)
			return
		end
	end
end

local function begin_resize(state, active)
	if not is_pip(active) then
		state.resize_anchor = nil
		return
	end

	local corner = tagged_corner(active)
	if not corner then
		state.resize_anchor = nil
		return
	end

	local x = tonumber(active.at[1]) or 0
	local y = tonumber(active.at[2]) or 0
	local width = tonumber(active.size[1]) or 0
	local height = tonumber(active.size[2]) or 0
	state.resize_anchor = {
		address = active.address,
		left = corner:match("left$") ~= nil,
		top = corner:match("^top") ~= nil,
		x = corner:match("left$") and x or x + width,
		y = corner:match("^top") and y or y + height,
	}
end

local function finish_resize(state, clients, commands)
	local anchor = state.resize_anchor
	state.resize_anchor = nil
	if not anchor then
		return
	end

	for _, window in ipairs(clients) do
		if window.address == anchor.address and is_pip(window) then
			local width = tonumber(window.size[1]) or 0
			local height = tonumber(window.size[2]) or 0
			local x = anchor.left and anchor.x or anchor.x - width
			local y = anchor.top and anchor.y or anchor.y - height
			move_window(state, commands, window, x, y)
			return
		end
	end
end

local function move_pip(state, mode, address, assign_default_corner, input, commands)
	for _, window in ipairs(input.clients) do
		if is_pip(window) and (address == nil or window.address == address) then
			local monitor = monitor_for(window, input.monitors)
			if monitor then
				local width = tonumber(window.size[1]) or 0
				local height = tonumber(window.size[2]) or 0
				local corner = tagged_corner(window)
				if corner == nil and assign_default_corner then
					local default_x = monitor.x + monitor.width - width - pip.margin
					local default_y = monitor.y + monitor.height - height - pip.margin
					-- A window-state rule has already restored any non-default position.
					if (tonumber(window.at[1]) or 0) ~= default_x or (tonumber(window.at[2]) or 0) ~= default_y then
						local restored_corner = snap_target(window, monitor, input.bars)
						if restored_corner then
							tag_corner(commands, window, restored_corner.corner)
						end
						return
					end
					corner = "bottom-right"
					tag_corner(commands, window, corner)
				end
				local normal_x = corner and corner:match("left$") and monitor.x + pip.margin
					or corner_x(window, monitor)
				local normal_y = monitor.y + monitor.height - height - pip.margin
				local window_rect = M.rectangle(window.at[1], window.at[2], width, height)
				local target_y
				if corner and corner:match("^bottom") then
					target_y = mode == "show" and bottom_y(window, monitor, normal_x, input.bars) or normal_y
				else
					for _, bar in ipairs(input.bars[monitor.name] or {}) do
						if mode == "show" and M.overlaps(window_rect, bar) then
							target_y = bottom_y(window, monitor, normal_x, input.bars)
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
					move_window(state, commands, window, normal_x, target_y)
				end
			end
		end
	end
end

local function ignore_event() end

local function handle_startup(state, input, commands)
	move_pip(state, state.waybar_visible and "show" or "hide", nil, nil, input, commands)
end

local function handle_drag_start(state, input)
	state.dragging = true
	state.dragging_address = input.event.address
	state.drag_source = "bind"
	state.settle_at = nil
end

local function handle_drag_end(state, input, commands)
	if state.dragging then
		update_preview(state, input, commands)
		snap_pip(state, state.dragging_address, input, commands)
	end
	stop_drag(state, input.now, commands)
end

local function handle_drag_cancel(state, input, commands)
	stop_drag(state, input.now, commands)
end

local function handle_resize_start(state, input)
	begin_resize(state, input.active)
end

local function handle_resize_end(state, input, commands)
	finish_resize(state, input.clients, commands)
end

local function handle_move(state, input, commands)
	local event = input.event
	if event.address and event.direction then
		move_pip_corner(state, event.direction, event.address, input, commands)
	end
end

local function handle_waybar_show(state, input, commands)
	state.waybar_visible = true
	move_pip(state, "show", nil, nil, input, commands)
end

local function handle_waybar_hide(state, input, commands)
	state.waybar_visible = false
	move_pip(state, "hide", nil, nil, input, commands)
end

local control_handlers = {
	["drag-start"] = handle_drag_start,
	["drag-end"] = handle_drag_end,
	["drag-cancel"] = handle_drag_cancel,
	["resize-start"] = handle_resize_start,
	["resize-end"] = handle_resize_end,
	move = handle_move,
	["waybar-show"] = handle_waybar_show,
	["waybar-hide"] = handle_waybar_hide,
	ping = ignore_event,
	quit = ignore_event,
}

local function handle_control(state, input, commands)
	local handler = control_handlers[input.event.action] or ignore_event
	handler(state, input, commands)
end

local function schedule_reconcile(state, input, assign_default_corner)
	local address = input.event.address
	if address == nil then
		return
	end

	state.reconcile_addresses[address] = state.reconcile_addresses[address] or assign_default_corner
	state.reconcile_at = input.now + open_window_delay_s
end

local compositor_handlers = {
	openwindow = function(state, input)
		state.next_observation_at = input.now
		schedule_reconcile(state, input, true)
	end,
	closewindow = function(state, input)
		state.next_observation_at = input.now
	end,
	resizewindow = function(state, input)
		if state.dragging == false and state.resize_anchor == nil then
			schedule_reconcile(state, input, false)
		end
	end,
}

local function handle_compositor(state, input, commands)
	local handler = compositor_handlers[input.event.name] or ignore_event
	handler(state, input, commands)
end

local function handle_tick(state, input, commands)
	local now = input.now
	if now >= state.next_observation_at then
		local has_pip = observe_client_drag(state, now, input.clients)
		state.next_observation_at = has_pip and now + drag_interval_s or math.huge
	end

	if state.dragging then
		update_preview(state, input, commands)
		if state.drag_source == "client" and state.settle_at and now >= state.settle_at then
			snap_pip(state, state.dragging_address, input, commands)
			stop_drag(state, now, commands)
		end
	end

	if state.reconcile_at and now >= state.reconcile_at then
		state.reconcile_at = nil
		local mode = state.waybar_visible and "show" or "hide"
		for address, assign_default_corner in pairs(state.reconcile_addresses) do
			move_pip(state, mode, address, assign_default_corner, input, commands)
			state.geometries[address] = nil
			state.reconcile_addresses[address] = nil
		end
		state.next_observation_at = now
	end
end

local event_handlers = {
	startup = handle_startup,
	monitorchange = handle_startup,
	control = handle_control,
	compositor = handle_compositor,
	tick = handle_tick,
}

--- Feed one event through the placement reducer.
--- input: { now, event, clients?, monitors?, bars?, active? }
--- event: { type = "startup" }
---      | { type = "monitorchange" }
---      | { type = "control", action, address?, direction? }
---      | { type = "compositor", name, address? }
---      | { type = "tick" }
--- Commands: move{address,x,y} · tag{address,tag,add} · preview{target?}
function M.place(state, input)
	local commands = {}
	local handler = event_handlers[input.event.type]
	if handler == nil then
		error("unknown PiP placement event type: " .. tostring(input.event.type))
	end

	handler(state, input, commands)
	return state, commands
end

return M
