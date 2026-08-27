-- Pure PiP placement reducer: owns snap geometry, waybar avoidance, the
-- client-drag state machine, corner-tag policy, and preview dedup behind one
-- interface. place(state, input) → (state, commands) over plain tables; the
-- picture-in-picture daemon adapts IPC data in and interprets commands out.
-- See CONTEXT.md ("PiP placement").

local pip = require("lib.picture_in_picture")

local M = {}

local drag_interval_s = 0.08
local acceptance_timeout_s = 0.5
local open_window_delay_s = 0.1
local waybar_position_vicinity = 12

M.drag_interval_s = drag_interval_s

function M.tick_due(state, now)
	return now >= state.next_observation_at or (state.reconcile_at ~= nil and now >= state.reconcile_at)
end

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
		dragging = false,
		dragging_address = nil,
		next_observation_at = math.huge,
		preview_signature = nil,
		resize_anchor = nil,
		resizing_address = nil,
		pending_acceptance = nil,
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

local function acceptance_corner_observed(window, expected_corner)
	if expected_corner then
		return has_tag(window, pip.corners[expected_corner].tag)
	end

	for _, tag in ipairs(window.tags or {}) do
		if tag:sub(-1) ~= "*" then
			for _, candidate in pairs(pip.corners) do
				if tag == candidate.tag then
					return false
				end
			end
		end
	end
	return true
end

local function queue_acceptance(state, input, window, monitor, corner, x, y)
	state.pending_acceptance = {
		address = window.address,
		corner = corner,
		deadline = input.now + acceptance_timeout_s,
		target_monitor = monitor.name,
		x = x,
		y = y,
	}
	state.next_observation_at = math.min(state.next_observation_at, input.now + drag_interval_s)
end

local function complete_pending_acceptance(state, input, commands)
	local pending = state.pending_acceptance
	if pending == nil then
		return
	end

	if input.now >= pending.deadline then
		state.pending_acceptance = nil
		commands[#commands + 1] = { kind = "acceptance-timeout" }
		return
	end

	for _, window in ipairs(input.clients) do
		if is_pip(window) and window.address == pending.address then
			local monitor = monitor_for(window, input.monitors)
			local x = tonumber(window.at[1]) or 0
			local y = tonumber(window.at[2]) or 0
			if
				monitor
				and monitor.name == pending.target_monitor
				and x == pending.x
				and y == pending.y
				and acceptance_corner_observed(window, pending.corner)
			then
				local accepted = {
					kind = pending.corner and "corner" or "free",
					target_monitor = monitor.name,
				}
				if pending.corner then
					accepted.corner = pending.corner
				else
					accepted.x = x - monitor.x
					accepted.y = y - monitor.y
				end
				commands[#commands + 1] = { kind = "accept-placement", placement = accepted }
				state.pending_acceptance = nil
			end
			return
		end
	end
end

local function move_window(state, commands, window, x, y)
	if (tonumber(window.at[1]) or 0) == x and (tonumber(window.at[2]) or 0) == y then
		return
	end

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
	state.dragging = false
	state.dragging_address = nil
	state.next_observation_at = state.pending_acceptance and now or math.huge
	set_preview(state, commands, nil)
end

local function snap_pip(state, address, input, commands)
	for _, window in ipairs(input.clients) do
		if is_pip(window) and (address == nil or window.address == address) then
			local monitor = monitor_for(window, input.monitors)
			if monitor then
				local command_count = #commands
				local target = snap_target(window, monitor, input.bars)
				if target then
					tag_corner(commands, window, target.corner)
					local x = target.x + monitor.x
					local y = target.y + monitor.y
					move_window(state, commands, window, x, y)
					return window, monitor, target.corner, x, y, #commands > command_count
				else
					clear_corner_tags(commands, window)
					return window,
						monitor,
						nil,
						tonumber(window.at[1]) or 0,
						tonumber(window.at[2]) or 0,
						#commands > command_count
				end
			end
		end
	end
end

local function is_direction(direction)
	return direction == "left" or direction == "right" or direction == "up" or direction == "down"
end

local function move_pip_corner(state, direction, address, input, commands)
	if is_direction(direction) == false then
		return
	end

	for _, window in ipairs(input.clients) do
		if is_pip(window) and window.address == address then
			local monitor = monitor_for(window, input.monitors)
			if not monitor then
				return
			end

			local command_count = #commands
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
			return window, monitor, target_corner, target_x, target_y, #commands > command_count
		end
	end
end

local function begin_resize(state, address, clients)
	state.resizing_address = nil
	local target
	for _, window in ipairs(clients) do
		if window.address == address then
			target = window
			break
		end
	end

	if not is_pip(target) then
		state.resize_anchor = nil
		return
	end
	state.resizing_address = target.address

	local corner = tagged_corner(target)
	if not corner then
		state.resize_anchor = nil
		return
	end

	local x = tonumber(target.at[1]) or 0
	local y = tonumber(target.at[2]) or 0
	local width = tonumber(target.size[1]) or 0
	local height = tonumber(target.size[2]) or 0
	state.resize_anchor = {
		address = target.address,
		corner = corner,
		left = corner:match("left$") ~= nil,
		top = corner:match("^top") ~= nil,
		x = corner:match("left$") and x or x + width,
		y = corner:match("^top") and y or y + height,
	}
end

local function finish_resize(state, input, commands)
	local anchor = state.resize_anchor
	state.resize_anchor = nil
	local address = state.resizing_address
	state.resizing_address = nil
	if address == nil then
		return
	end

	for _, window in ipairs(input.clients) do
		if window.address == address and is_pip(window) then
			local monitor = monitor_for(window, input.monitors)
			if monitor == nil then
				return
			end
			local command_count = #commands
			local width = tonumber(window.size[1]) or 0
			local height = tonumber(window.size[2]) or 0
			local x = tonumber(window.at[1]) or 0
			local y = tonumber(window.at[2]) or 0
			local corner = tagged_corner(window)
			if anchor then
				x = anchor.left and anchor.x or anchor.x - width
				y = anchor.top and anchor.y or anchor.y - height
				corner = anchor.corner
				move_window(state, commands, window, x, y)
			end
			return window, monitor, corner, x, y, #commands > command_count
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
				if corner then
					target_y = corner:match("^top") and monitor.y + pip.margin
						or (mode == "show" and bottom_y(window, monitor, normal_x, input.bars) or normal_y)
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

local function cancel_reconcile(state, address)
	if address == nil then
		return
	end

	state.reconcile_addresses[address] = nil
	if next(state.reconcile_addresses) == nil then
		state.reconcile_at = nil
	end
end

local function handle_startup(state, input, commands)
	move_pip(state, state.waybar_visible and "show" or "hide", nil, nil, input, commands)
end

local function handle_drag_start(state, input)
	state.pending_acceptance = nil
	state.dragging = true
	state.dragging_address = input.event.address
	state.next_observation_at = input.now
	cancel_reconcile(state, state.dragging_address)
end

local function handle_drag_end(state, input, commands)
	if state.dragging then
		update_preview(state, input, commands)
		local window, monitor, corner, x, y, needs_observation =
			snap_pip(state, state.dragging_address, input, commands)
		if window then
			queue_acceptance(state, input, window, monitor, corner, x, y)
			if needs_observation == false then
				complete_pending_acceptance(state, input, commands)
			end
		end
	end
	stop_drag(state, input.now, commands)
end

local function handle_drag_cancel(state, input, commands)
	stop_drag(state, input.now, commands)
end

local function handle_resize_start(state, input)
	state.pending_acceptance = nil
	begin_resize(state, input.event.address, input.clients)
	cancel_reconcile(state, state.resizing_address)
end

local function handle_resize_end(state, input, commands)
	local window, monitor, corner, x, y, needs_observation = finish_resize(state, input, commands)
	if window then
		queue_acceptance(state, input, window, monitor, corner, x, y)
		if needs_observation == false then
			complete_pending_acceptance(state, input, commands)
		end
	end
end

local function handle_resize_cancel(state)
	state.resize_anchor = nil
	state.resizing_address = nil
end

local function handle_move(state, input, commands)
	local event = input.event
	if event.address and is_direction(event.direction) then
		state.pending_acceptance = nil
		local window, monitor, corner, x, y, needs_observation =
			move_pip_corner(state, event.direction, event.address, input, commands)
		if window then
			queue_acceptance(state, input, window, monitor, corner, x, y)
			if needs_observation == false then
				complete_pending_acceptance(state, input, commands)
			end
		end
	end
end

local function handle_waybar_show(state, input, commands)
	state.pending_acceptance = nil
	state.waybar_visible = true
	move_pip(state, "show", nil, nil, input, commands)
end

local function handle_waybar_hide(state, input, commands)
	state.pending_acceptance = nil
	state.waybar_visible = false
	move_pip(state, "hide", nil, nil, input, commands)
end

local control_handlers = {
	["drag-start"] = handle_drag_start,
	["drag-end"] = handle_drag_end,
	["drag-cancel"] = handle_drag_cancel,
	["resize-start"] = handle_resize_start,
	["resize-end"] = handle_resize_end,
	["resize-cancel"] = handle_resize_cancel,
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
		schedule_reconcile(state, input, true)
	end,
	closewindow = ignore_event,
	resizewindow = function(state, input)
		if state.dragging == false and state.resizing_address == nil then
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
	if state.dragging then
		update_preview(state, input, commands)
	end

	complete_pending_acceptance(state, input, commands)
	state.next_observation_at = (state.dragging or state.pending_acceptance) and now + drag_interval_s or math.huge

	if state.reconcile_at and now >= state.reconcile_at then
		state.reconcile_at = nil
		local mode = state.waybar_visible and "show" or "hide"
		for address, assign_default_corner in pairs(state.reconcile_addresses) do
			move_pip(state, mode, address, assign_default_corner, input, commands)
			state.reconcile_addresses[address] = nil
		end
	end
end

local event_handlers = {
	startup = handle_startup,
	configreload = ignore_event,
	monitorchange = function(state, input, commands)
		state.pending_acceptance = nil
		handle_startup(state, input, commands)
	end,
	control = handle_control,
	compositor = handle_compositor,
	tick = handle_tick,
}

--- Feed one event through the placement reducer.
--- input: { now, event, clients?, monitors?, bars?, active? }
--- event: { type = "startup" }
---      | { type = "configreload" }
---      | { type = "monitorchange" }
---      | { type = "control", action, address?, direction? }
---      | { type = "compositor", name, address? }
---      | { type = "tick" }
--- Commands: move{address,x,y} · tag{address,tag,add} · preview{target?} · accept-placement{placement}
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
